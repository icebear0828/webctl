/**
 * Browser-based transports — two tiers:
 *   1. CDPTransport: connect to running local Chrome via CDP (lightweight)
 *   2. LaunchTransport: launch new Playwright browser (heavyweight, fallback)
 *
 * Both use page.evaluate(fetch(...)) to inherit browser cookies/TLS.
 * Playwright is an optional peer dependency, lazy-imported at runtime.
 */

import type { Transport, RequestOptions, TransportResponse, Cookie } from './transport.js';
import { ensureProfileDir } from './profiles.js';

// ── Shared page.evaluate fetch logic ──

async function evaluateFetch(
  page: import('playwright').Page,
  opts: RequestOptions,
): Promise<TransportResponse> {
  const result = await page.evaluate(async (req: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | undefined;
  }) => {
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      credentials: 'include',
    });

    const contentType = res.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json')
      ? await res.json()
      : await res.text();

    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });

    return { status: res.status, headers, body };
  }, {
    url: opts.url,
    method: opts.method ?? 'GET',
    headers: opts.headers ?? {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  return result as TransportResponse;
}

async function extractCookies(
  context: import('playwright').BrowserContext,
  domain?: string,
): Promise<Cookie[]> {
  const cookies = await context.cookies();
  const filtered = domain
    ? cookies.filter(c => c.domain.includes(domain))
    : cookies;
  return filtered.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
  }));
}

async function loadPlaywright(): Promise<typeof import('playwright')> {
  try {
    return await import('playwright');
  } catch {
    throw new Error(
      'Browser transport requires playwright. Install it with: pnpm add playwright',
    );
  }
}

// ── CDP Transport: connect to running Chrome ──

const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';

export interface CDPTransportOptions {
  /** CDP endpoint URL. Default: http://127.0.0.1:9222 */
  endpointUrl?: string;
  /** Navigate to this domain before making requests (for cookie scope) */
  domain?: string;
}

export class CDPTransport implements Transport {
  private browser: import('playwright').Browser | null = null;
  private context: import('playwright').BrowserContext | null = null;
  private page: import('playwright').Page | null = null;
  private options: CDPTransportOptions;

  constructor(options?: CDPTransportOptions) {
    this.options = options ?? {};
  }

  async connect(): Promise<void> {
    const pw = await loadPlaywright();
    const endpoint = this.options.endpointUrl ?? DEFAULT_CDP_URL;

    this.browser = await pw.chromium.connectOverCDP(endpoint);
    const contexts = this.browser.contexts();
    this.context = contexts[0] ?? await this.browser.newContext();
    const pages = this.context.pages();
    this.page = pages[0] ?? await this.context.newPage();
  }

  async navigateTo(url: string): Promise<void> {
    if (!this.page) await this.connect();
    await this.page!.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async request(opts: RequestOptions): Promise<TransportResponse> {
    if (!this.page) await this.connect();
    return evaluateFetch(this.page!, opts);
  }

  async getCookies(domain?: string): Promise<Cookie[]> {
    if (!this.context) return [];
    return extractCookies(this.context, domain);
  }

  async getPage(): Promise<import('playwright').Page> {
    if (!this.page) await this.connect();
    return this.page!;
  }

  async dispose(): Promise<void> {
    // Don't close the user's browser — just disconnect
    if (this.browser) {
      this.browser.close().catch(() => {});
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }

  /** Check if a Chrome instance is reachable at the CDP endpoint. */
  static async isAvailable(endpointUrl?: string): Promise<boolean> {
    const url = endpointUrl ?? DEFAULT_CDP_URL;
    try {
      const res = await fetch(`${url}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

// ── Launch Transport: start new Playwright browser ──

export interface LaunchTransportOptions {
  site: string;
  headless?: boolean;
  executablePath?: string;
}

export class LaunchTransport implements Transport {
  private context: import('playwright').BrowserContext | null = null;
  private page: import('playwright').Page | null = null;
  private options: LaunchTransportOptions;

  constructor(options: LaunchTransportOptions) {
    this.options = options;
  }

  async launch(): Promise<void> {
    const pw = await loadPlaywright();
    const profileDir = await ensureProfileDir(this.options.site);

    this.context = await pw.chromium.launchPersistentContext(profileDir, {
      headless: this.options.headless ?? false,
      executablePath: this.options.executablePath,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--remote-allow-origins=*',
      ],
    });

    this.page = this.context.pages()[0] ?? await this.context.newPage();
  }

  async navigateTo(url: string): Promise<void> {
    if (!this.page) await this.launch();
    await this.page!.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async request(opts: RequestOptions): Promise<TransportResponse> {
    if (!this.page) await this.launch();
    return evaluateFetch(this.page!, opts);
  }

  async getCookies(domain?: string): Promise<Cookie[]> {
    if (!this.context) return [];
    return extractCookies(this.context, domain);
  }

  async getPage(): Promise<import('playwright').Page> {
    if (!this.page) await this.launch();
    return this.page!;
  }

  async dispose(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.page = null;
    }
  }
}

// ── Resolver: pick the best transport ──

export type BrowserTransportTier = 'cdp' | 'launch';

export interface BrowserTransportResolved {
  transport: CDPTransport | LaunchTransport;
  tier: BrowserTransportTier;
}

/**
 * Resolve the best browser transport:
 *   1. Try CDP connection to local Chrome (fast, reuses existing session)
 *   2. Fall back to launching a new browser instance
 */
export async function resolveBrowserTransport(options: {
  site: string;
  cdpUrl?: string;
  headless?: boolean;
  executablePath?: string;
  preferTier?: BrowserTransportTier;
}): Promise<BrowserTransportResolved> {
  // If user explicitly requests a tier, use it
  if (options.preferTier === 'launch') {
    const transport = new LaunchTransport({
      site: options.site,
      headless: options.headless,
      executablePath: options.executablePath,
    });
    await transport.launch();
    return { transport, tier: 'launch' };
  }

  // Try CDP first
  const cdpAvailable = await CDPTransport.isAvailable(options.cdpUrl);
  if (cdpAvailable) {
    try {
      const transport = new CDPTransport({ endpointUrl: options.cdpUrl });
      await transport.connect();
      return { transport, tier: 'cdp' };
    } catch {
      // CDP failed, fall through to launch
    }
  }

  // Fall back to launch
  const transport = new LaunchTransport({
    site: options.site,
    headless: options.headless,
    executablePath: options.executablePath,
  });
  await transport.launch();
  return { transport, tier: 'launch' };
}
