/**
 * Suno site adapter — registers CLI commands.
 *
 * Auth: Browser login to extract Clerk JWT + cookies.
 * Session refresh: POST auth.suno.com/v1/client/sessions/{id}/touch
 */

import { readFile } from 'node:fs/promises';
import { cli, Strategy, type CommandArgs } from '../../core/registry.js';
import { createSessionStore } from '../../core/session.js';
import { resolveBrowserTransport } from '../../core/browser.js';
import { SunoClient } from './client.js';
import type { SunoSession } from './types.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getStore() {
  return createSessionStore<SunoSession>({ site: 'suno', ttlMs: SESSION_TTL_MS });
}

function getClient(): SunoClient {
  return new SunoClient(getStore());
}

// ── Auth ──

cli({
  site: 'suno',
  name: 'login',
  description: 'Login via browser and save Suno session',
  domain: 'suno.com',
  strategy: Strategy.BROWSER,
  args: [
    { name: 'user', help: 'Session user ID (default: "default")' },
  ],
  func: async (_t, _s, kwargs: CommandArgs) => {
    const store = getStore();
    const userId = kwargs['user'] as string | undefined;

    const { transport } = await resolveBrowserTransport({
      site: 'suno',
      headless: false,
      preferTier: 'launch',
    });

    try {
      await transport.navigateTo('https://suno.com/create');

      const page = await transport.getPage();

      console.error('[auth] Waiting for Suno login... (complete login in the browser window)');

      // Wait for the authenticated create page (has a text input for prompts)
      await page.waitForFunction(
        () => {
          const el = document.querySelector('textarea, [placeholder*="song"], [placeholder*="music"], [data-testid="create-input"]');
          return el !== null;
        },
        { timeout: 120_000 },
      );

      // Extract cookies from all relevant domains
      const allCookies = await transport.getCookies();
      const siteCookies = allCookies
        .filter(c => c.domain && (c.domain.includes('suno.com') || c.domain.includes('suno.ai')))
        .map(c => `${c.name}=${c.value}`)
        .join('; ');
      const authCookies = allCookies
        .filter(c => c.domain && c.domain.includes('auth.suno.com'))
        .map(c => `${c.name}=${c.value}`)
        .join('; ');

      const userAgent = await page.evaluate(() => navigator.userAgent) as string;

      // Extract device ID from cookies
      const deviceIdCookie = allCookies.find(c => c.name === 'suno_device_id');
      const deviceId = deviceIdCookie?.value ?? '';

      // Extract JWT and session ID from cookies
      const sessionCookie = allCookies.find(c => c.name === '__session' && c.domain?.includes('suno.com'));
      if (!sessionCookie?.value) {
        throw new Error('Could not find __session cookie. Make sure you are logged in.');
      }

      const jwt = sessionCookie.value;

      // Decode JWT to get expiry and session ID
      let jwtExpiry = Date.now() + 60 * 60 * 1000;
      let sessionId = '';
      try {
        const parts = jwt.split('.');
        if (parts.length === 3 && parts[1]) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as {
            exp?: number;
            sid?: string;
          };
          if (payload.exp) jwtExpiry = payload.exp * 1000;
          if (payload.sid) sessionId = payload.sid;
        }
      } catch { /* fallback */ }

      if (!sessionId) {
        throw new Error('Could not extract session ID from JWT.');
      }

      const session: SunoSession = {
        jwt,
        jwtExpiry,
        sessionId,
        authCookies,
        siteCookies,
        deviceId,
        userAgent,
      };

      await store.save(session, userId);
      console.error('[auth] Suno session saved');

      return {
        status: 'logged_in',
        sessionId,
        deviceId,
        jwtExpiry: new Date(jwtExpiry).toISOString(),
      };
    } finally {
      await transport.dispose();
    }
  },
});

// ── Generate ──

cli({
  site: 'suno',
  name: 'generate',
  description: 'Generate music with Suno',
  domain: 'suno.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'prompt', positional: true, help: 'Song prompt / lyrics (inline)' },
    { name: 'prompt-file', help: 'Path to a file containing the lyrics/prompt (preferred for long text)' },
    { name: 'tags', help: 'Style tags inline (e.g. "mandopop, piano ballad")' },
    { name: 'tags-file', help: 'Path to a file containing style tags' },
    { name: 'title', help: 'Song title' },
    { name: 'instrumental', help: 'Instrumental only (true/false)', default: 'false' },
    { name: 'mv', help: 'Model version (default: chirp-fenix)' },
    { name: 'no-wait', help: 'Return immediately without polling for completion' },
    { name: 'captcha-token', help: 'PerimeterX captcha token (P1_...) if required' },
    { name: 'user', help: 'Session user ID' },
  ],
  columns: ['id', 'status', 'title', 'audioUrl', 'duration'],
  func: async (_transport, _session, kwargs: CommandArgs) => {
    const client = getClient();
    const userId = kwargs['user'] as string | undefined;
    const loaded = await client.loadSession(userId);
    if (!loaded) throw new Error('No session found. Run `webctl suno login` first.');

    try {
      // Resolve prompt: --prompt-file takes precedence over positional
      let prompt = kwargs['prompt'] as string | undefined;
      const promptFile = kwargs['prompt-file'] as string | undefined;
      if (promptFile) {
        prompt = await readFile(promptFile, 'utf-8');
      }
      if (!prompt) throw new Error('Provide lyrics via positional argument or --prompt-file.');

      // Resolve tags: --tags-file takes precedence over --tags
      let tags = kwargs['tags'] as string | undefined;
      const tagsFile = kwargs['tags-file'] as string | undefined;
      if (tagsFile) {
        tags = (await readFile(tagsFile, 'utf-8')).trim();
      }

      const result = await client.generate({
        prompt,
        tags,
        title: kwargs['title'] as string | undefined,
        instrumental: kwargs['instrumental'] === 'true',
        mv: kwargs['mv'] as string | undefined,
        captchaToken: kwargs['captcha-token'] as string | undefined,
      });

      if (kwargs['no-wait']) {
        return result.clips;
      }

      console.error(`[generate] Batch ${result.batchId} — polling ${result.clips.length} clip(s)...`);

      const clipIds = result.clips.map(c => c.id);
      const completed = await client.waitForCompletion(clipIds);

      // Fetch WAV URLs for all completed clips
      const withWav = await Promise.all(
        completed.map(async clip => {
          if (clip.status !== 'complete') return clip;
          try {
            const wavUrl = await client.getWavUrl(clip.id);
            await client.trackDownload(clip.id);
            return { ...clip, wavUrl };
          } catch {
            return clip;
          }
        }),
      );

      return withWav;
    } finally {
      await client.dispose();
    }
  },
});

// ── Download ──

cli({
  site: 'suno',
  name: 'download',
  description: 'Get download URL for a Suno clip',
  domain: 'suno.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'clip-id', required: true, positional: true, help: 'Clip UUID' },
    { name: 'format', help: 'Format: mp3 or wav (default: wav)' },
    { name: 'user', help: 'Session user ID' },
  ],
  columns: ['clipId', 'format', 'url'],
  func: async (_transport, _session, kwargs: CommandArgs) => {
    const client = getClient();
    const userId = kwargs['user'] as string | undefined;
    const loaded = await client.loadSession(userId);
    if (!loaded) throw new Error('No session found. Run `webctl suno login` first.');

    const clipId = kwargs['clip-id'] as string;
    const format = (kwargs['format'] as string | undefined) ?? 'wav';

    try {
      let url: string;

      if (format === 'wav') {
        url = await client.getWavUrl(clipId);
      } else {
        // MP3 is directly accessible from CDN
        url = `https://cdn1.suno.ai/${clipId}.mp3`;
      }

      await client.trackDownload(clipId);

      return { clipId, format, url };
    } finally {
      await client.dispose();
    }
  },
});

// ── Poll ──

cli({
  site: 'suno',
  name: 'poll',
  description: 'Poll clip status by IDs',
  domain: 'suno.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'clip-ids', required: true, positional: true, help: 'Comma-separated clip UUIDs' },
    { name: 'user', help: 'Session user ID' },
  ],
  columns: ['id', 'status', 'title', 'audioUrl', 'duration'],
  func: async (_transport, _session, kwargs: CommandArgs) => {
    const client = getClient();
    const userId = kwargs['user'] as string | undefined;
    const loaded = await client.loadSession(userId);
    if (!loaded) throw new Error('No session found. Run `webctl suno login` first.');

    const clipIds = (kwargs['clip-ids'] as string).split(',').map(s => s.trim());

    try {
      return await client.pollClips(clipIds);
    } finally {
      await client.dispose();
    }
  },
});

export { SunoClient } from './client.js';
export type { SunoSession, SunoClip, SunoGenerateResponse } from './types.js';
