/**
 * BrowserTransport — Playwright-based, optional dependency.
 * Uses page.evaluate(fetch(...)) to inherit browser cookies/TLS.
 */

import type { Transport, RequestOptions, TransportResponse, Cookie } from './transport.js';
import { ensureProfileDir } from './profiles.js';

interface BrowserTransportOptions {
  site: string;
  headless?: boolean;
  executablePath?: string;
}

export class BrowserTransport implements Transport {
  private browser: unknown = null;
  private page: unknown = null;
  private options: BrowserTransportOptions;

  constructor(options: BrowserTransportOptions) {
    this.options = options;
  }

  async launch(): Promise<void> {
    let playwright: typeof import('playwright');
    try {
      playwright = await import('playwright');
    } catch {
      throw new Error(
        'BrowserTransport requires playwright. Install it with: pnpm add playwright',
      );
    }

    const profileDir = await ensureProfileDir(this.options.site);
    const context = await playwright.chromium.launchPersistentContext(profileDir, {
      headless: this.options.headless ?? false,
      executablePath: this.options.executablePath,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--remote-allow-origins=*',
      ],
    });

    this.browser = context;
    this.page = context.pages()[0] ?? await context.newPage();
  }

  async navigateTo(url: string): Promise<void> {
    const page = this.page as import('playwright').Page;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async request(opts: RequestOptions): Promise<TransportResponse> {
    if (!this.page) {
      await this.launch();
    }

    const page = this.page as import('playwright').Page;

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

  async getCookies(domain?: string): Promise<Cookie[]> {
    if (!this.page) return [];
    const context = this.browser as import('playwright').BrowserContext;
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

  async getPage(): Promise<import('playwright').Page> {
    if (!this.page) {
      await this.launch();
    }
    return this.page as import('playwright').Page;
  }

  async dispose(): Promise<void> {
    if (this.browser) {
      const context = this.browser as import('playwright').BrowserContext;
      await context.close();
      this.browser = null;
      this.page = null;
    }
  }
}
