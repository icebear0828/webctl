/**
 * Session extraction from user's own Chrome profile.
 *
 * Uses Playwright's launchPersistentContext with the user's Chrome profile
 * directory, so existing Google login is inherited — no manual login needed.
 *
 * Flow:
 *   1. Launch Chromium with user's Chrome profile (already logged in)
 *   2. Navigate to the service URL
 *   3. Extract WIZ_global_data tokens + cookies
 *   4. Save session and close browser
 */

import { platform, homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionStore } from './session.js';

export interface GoogleServiceAuthOptions {
  site: string;
  dashboardUrl: string;
  blValidator: string;
  /** Chrome profile path override. Default: auto-detect user's Chrome. */
  chromeProfile?: string;
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
 * Auto-detect the user's default Chrome profile directory.
 */
function detectChromeProfile(): string {
  const home = homedir();
  const candidates: string[] = [];

  switch (platform()) {
    case 'darwin':
      candidates.push(join(home, 'Library', 'Application Support', 'Google', 'Chrome'));
      break;
    case 'win32':
      candidates.push(join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data'));
      break;
    default: // linux
      candidates.push(join(home, '.config', 'google-chrome'));
      candidates.push(join(home, '.config', 'chromium'));
      break;
  }

  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }

  throw new Error(
    'Chrome profile not found. Specify path with --chrome-profile or install Google Chrome.',
  );
}

/**
 * Extract session from user's Chrome.
 *
 * Opens a temporary Chromium instance with the user's Chrome profile
 * (inheriting existing Google login), navigates to the service, extracts
 * tokens and cookies, then closes.
 *
 * IMPORTANT: User's Chrome must be closed first — Chrome locks its profile.
 */
export async function browserLogin<T extends GoogleServiceSession>(
  options: GoogleServiceAuthOptions,
  store: SessionStore<T>,
  extraFields?: Partial<T>,
): Promise<T> {
  let pw: typeof import('playwright');
  try {
    pw = await import('playwright');
  } catch {
    throw new Error('browserLogin requires playwright. Install with: pnpm add playwright');
  }

  const profileDir = options.chromeProfile ?? detectChromeProfile();

  console.error(`[auth] Using Chrome profile: ${profileDir}`);
  console.error(`[auth] Make sure Chrome is closed before proceeding.`);

  const context = await pw.chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--remote-allow-origins=*',
    ],
    timeout: 30000,
  });

  try {
    const page = context.pages()[0] ?? await context.newPage();

    await page.goto(options.dashboardUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const currentUrl = page.url();
    if (currentUrl.includes('accounts.google.com')) {
      console.error('[auth] Not logged in. Please log in to Google in the browser window...');
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
      { timeout: options.loginTimeout ?? 60000 },
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

    // Extract cookies
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
    await context.close();
  }
}
