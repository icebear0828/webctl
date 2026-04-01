/**
 * ChatGPT site adapter — registers CLI commands.
 *
 * Auth: Browser login to extract session cookie + access token.
 * No account registration, pooling, or sentinel/PoW handling.
 */

import { randomUUID } from 'node:crypto';
import { cli, Strategy, type CommandArgs } from '../../core/registry.js';
import { createSessionStore } from '../../core/session.js';
import { resolveBrowserTransport } from '../../core/browser.js';
import { ChatGPTClient } from './client.js';
import type { ChatGPTSession } from './types.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (access token refreshed on load)

function getStore() {
  return createSessionStore<ChatGPTSession>({ site: 'chatgpt', ttlMs: SESSION_TTL_MS });
}

function getClient(): ChatGPTClient {
  return new ChatGPTClient(getStore());
}

// ── Auth ──

cli({
  site: 'chatgpt',
  name: 'login',
  description: 'Login via browser and save session',
  domain: 'chatgpt.com',
  strategy: Strategy.BROWSER,
  args: [
    { name: 'user', help: 'Session user ID' },
  ],
  func: async (_t, _s, kwargs: CommandArgs) => {
    const store = getStore();
    const userId = kwargs['user'] as string | undefined;

    console.error('[auth] Launching browser for ChatGPT login...');

    const { transport } = await resolveBrowserTransport({
      site: 'chatgpt',
      headless: false,
      preferTier: 'launch',
    });

    try {
      await transport.navigateTo('https://chatgpt.com/');

      const page = await transport.getPage();

      // Wait for successful login — page should have accessToken in session endpoint
      console.error('[auth] Waiting for login... (complete login in the browser window)');

      await page.waitForFunction(
        () => document.querySelector('[data-testid="send-button"], [data-testid="composer-send-button"], textarea')
          !== null,
        { timeout: 120_000 },
      );

      // Extract cookies
      const cookies = await transport.getCookies('chatgpt.com');
      const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      const userAgent = await page.evaluate(() => navigator.userAgent);

      // Fetch access token via session endpoint (using browser context)
      const sessionResp = await transport.request({
        url: 'https://chatgpt.com/api/auth/session',
        method: 'GET',
        headers: { 'User-Agent': userAgent },
      });

      const sessionData = sessionResp.body as { accessToken?: string; expires?: string };
      if (!sessionData.accessToken) {
        throw new Error('Failed to extract access token. Make sure you are logged in.');
      }

      // Parse expiry
      let expiry = 0;
      if (sessionData.expires) {
        expiry = new Date(sessionData.expires).getTime();
      }
      if (!expiry) {
        const parts = sessionData.accessToken.split('.');
        if (parts.length === 3 && parts[1]) {
          try {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as { exp?: number };
            if (payload.exp) expiry = payload.exp * 1000;
          } catch { /* fallback */ }
        }
      }
      if (!expiry) {
        expiry = Date.now() + 60 * 60 * 1000;
      }

      const session: ChatGPTSession = {
        accessToken: sessionData.accessToken,
        accessTokenExpiry: expiry,
        cookies: cookieStr,
        userAgent,
        deviceId: randomUUID(),
      };

      await store.save(session, userId);
      console.error('[auth] Session saved for chatgpt');

      return { status: 'logged_in' };
    } finally {
      await transport.dispose();
    }
  },
});

// ── Chat ──

cli({
  site: 'chatgpt',
  name: 'chat',
  description: 'Send a message to ChatGPT',
  domain: 'chatgpt.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'message', required: true, positional: true, help: 'Message to send' },
    { name: 'model', help: 'Model: auto, gpt-4o, o1, o3-mini, etc. (default: auto)' },
    { name: 'conversation-id', help: 'Continue an existing conversation' },
    { name: 'parent-message-id', help: 'Parent message ID for conversation context' },
    { name: 'user', help: 'Session user ID (default: "default")' },
  ],
  columns: ['text', 'conversationId', 'model'],
  func: async (_transport, _session, kwargs: CommandArgs) => {
    const client = getClient();
    const userId = kwargs['user'] as string | undefined;
    const loaded = await client.loadSession(userId);
    if (!loaded) throw new Error('No session found. Run `webctl chatgpt login` first.');

    try {
      const response = await client.chat(
        kwargs['message'] as string,
        {
          model: kwargs['model'] as string | undefined,
          conversationId: kwargs['conversation-id'] as string | undefined,
          parentMessageId: kwargs['parent-message-id'] as string | undefined,
        },
      );
      return {
        text: response.text,
        conversationId: response.conversationId,
        messageId: response.messageId,
        model: response.model,
      };
    } finally {
      await client.dispose();
    }
  },
});

// ── Models ──

cli({
  site: 'chatgpt',
  name: 'models',
  description: 'List available models',
  domain: 'chatgpt.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'user', help: 'Session user ID' },
  ],
  columns: ['slug', 'title', 'maxTokens'],
  func: async (_transport, _session, kwargs: CommandArgs) => {
    const client = getClient();
    const userId = kwargs['user'] as string | undefined;
    const loaded = await client.loadSession(userId);
    if (!loaded) throw new Error('No session found. Run `webctl chatgpt login` first.');

    try {
      return await client.models();
    } finally {
      await client.dispose();
    }
  },
});

export { ChatGPTClient } from './client.js';
export type { ChatGPTSession, ChatGPTResponse, ChatGPTModel } from './types.js';
