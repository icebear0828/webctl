/**
 * Gemini site adapter — registers CLI commands.
 */

import { cli, Strategy, type CommandArgs } from '../../core/registry.js';
import { createSessionStore } from '../../core/session.js';
import { browserLogin } from '../../core/auth.js';
import { GeminiClient } from './client.js';
import type { GeminiSession } from './types.js';

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function getStore() {
  return createSessionStore<GeminiSession>({ site: 'gemini', ttlMs: SESSION_TTL_MS });
}

function getClient(): GeminiClient {
  return new GeminiClient(getStore());
}

// ── Auth ──

cli({
  site: 'gemini',
  name: 'login',
  description: 'Login via browser and save session',
  domain: 'gemini.google.com',
  strategy: Strategy.BROWSER,
  args: [{ name: 'user', help: 'Session user ID' }],
  func: async (_t, _s, kwargs: CommandArgs) => {
    const store = getStore();
    await browserLogin<GeminiSession>(
      { site: 'gemini', dashboardUrl: 'https://gemini.google.com/app', blValidator: 'assistant-bard' },
      store,
      { serviceHash: '', sessionHash: '' },
    );
    return { status: 'logged_in' };
  },
});

cli({
  site: 'gemini',
  name: 'chat',
  description: 'Send a message to Gemini',
  domain: 'gemini.google.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'message', required: true, positional: true, help: 'Message to send' },
    { name: 'conversation', help: 'Conversation ID for multi-turn' },
    { name: 'user', help: 'Session user ID (default: "default")' },
  ],
  columns: ['text', 'conversationId'],
  func: async (_transport, _session, kwargs: CommandArgs) => {
    const client = getClient();
    const userId = kwargs['user'] as string | undefined;
    const loaded = await client.loadSession(userId);
    if (!loaded) {
      throw new Error('No session found. Run `webctl gemini auth login` first.');
    }
    const response = await client.chat(
      kwargs['message'] as string,
      kwargs['conversation'] as string | undefined,
    );
    return {
      text: response.text,
      conversationId: response.conversationId,
      responseId: response.responseId,
      images: response.images.length > 0 ? response.images : undefined,
    };
  },
});

export { GeminiClient } from './client.js';
export type { GeminiSession, GeminiResponse, GeminiImage } from './types.js';
