/**
 * Browser-based auth flow — when HTTP session refresh fails,
 * launch browser, let user login, extract session tokens.
 *
 * Works for any Google-connected service (Gemini, NotebookLM, etc.)
 * by navigating to the service URL and extracting WIZ_global_data tokens.
 */

import type { SessionStore } from './session.js';
import { resolveBrowserTransport, type BrowserTransportResolved } from './browser.js';
import { getSetCookies, mergeCookies } from './cookies.js';

export interface GoogleServiceAuthOptions {
  /** Site name for profile directory */
  site: string;
  /** Service dashboard URL to navigate to */
  dashboardUrl: string;
  /** Expected substring in bl token (e.g. 'assistant-bard', 'labs-tailwind') */
  blValidator: string;
  /** Timeout for waiting for login (ms, default 180000) */
  loginTimeout?: number;
}

export interface GoogleServiceSession {
  at: string;
  bl: string;
  fsid: string;
  cookies: string;
  userAgent: string;
}

/**
 * Launch browser, navigate to Google service, wait for login,
 * extract WIZ_global_data session tokens + cookies.
 *
 * Priority: CDP (connect to existing Chrome) → Launch new browser.
 */
export async function browserLogin<T extends GoogleServiceSession>(
  options: GoogleServiceAuthOptions,
  store: SessionStore<T>,
  extraFields?: Partial<T>,
): Promise<T> {
  let resolved: BrowserTransportResolved | null = null;

  try {
    resolved = await resolveBrowserTransport({ site: options.site });
    const page = await resolved.transport.getPage();

    // Navigate to service
    await page.goto(options.dashboardUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const currentUrl = page.url();
    const needsLogin = currentUrl.includes('accounts.google.com');

    if (needsLogin) {
      console.error(`[auth] Please log in to Google in the browser window...`);
    }

    // Wait for WIZ_global_data tokens
    const blValidator = options.blValidator;
    await page.waitForFunction(
      (validator) => {
        const wiz = (window as unknown as Record<string, unknown>)['WIZ_global_data'] as Record<string, string> | undefined;
        if (!wiz) return false;
        const bl = wiz['cfb2h'] ?? '';
        return !!wiz['SNlM0e'] && bl.includes(validator);
      },
      blValidator,
      { timeout: options.loginTimeout ?? 180000 },
    );

    // Extract tokens
    const sessionData = await page.evaluate(() => {
      const wiz = (window as unknown as Record<string, unknown>)['WIZ_global_data'] as Record<string, string>;
      return {
        at: wiz['SNlM0e'] ?? '',
        bl: wiz['cfb2h'] ?? '',
        fsid: wiz['FdrFJe'] ?? '',
        userAgent: navigator.userAgent,
      };
    });

    // Extract cookies via context
    const context = page.context();
    const cookies = await context.cookies();
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const session = {
      ...sessionData,
      cookies: cookieStr,
      ...extraFields,
    } as T;

    await store.save(session);
    console.error(`[auth] Session saved for ${options.site}`);

    return session;
  } finally {
    if (resolved) {
      await resolved.transport.dispose();
    }
  }
}
