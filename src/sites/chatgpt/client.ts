/**
 * ChatGPT HTTP client — undici + Chrome TLS fingerprint + Bearer token auth.
 *
 * Auth: Access token from /api/auth/session, sent as Authorization header.
 * Session cookie (__Secure-next-auth.session-token) used to refresh tokens.
 */

import { request, type Agent } from 'undici';
import { randomUUID } from 'node:crypto';
import type { ChatGPTSession, ChatGPTResponse, ChatGPTModel } from './types.js';
import type { SessionStore } from '../../core/session.js';
import { createChromeTlsAgent } from '../../core/tls.js';
import { parseSSEStream } from './parser.js';

const BASE_URL = 'https://chatgpt.com';
const CONVERSATION_URL = `${BASE_URL}/backend-api/conversation`;
const MODELS_URL = `${BASE_URL}/backend-api/models?history_and_training_disabled=false`;
const SESSION_URL = `${BASE_URL}/api/auth/session`;

const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

export class ChatGPTClient {
  private session: ChatGPTSession | null = null;
  private store: SessionStore<ChatGPTSession>;
  private agent: Agent;

  constructor(store: SessionStore<ChatGPTSession>) {
    this.store = store;
    this.agent = createChromeTlsAgent();
  }

  async loadSession(userId?: string): Promise<boolean> {
    this.session = await this.store.load(userId);
    if (!this.session) return false;

    // Refresh access token if expired (with 5min margin)
    if (Date.now() > this.session.accessTokenExpiry - 5 * 60 * 1000) {
      const refreshed = await this.refreshAccessToken();
      if (!refreshed) return false;
      await this.store.save(this.session, userId);
    }

    return true;
  }

  async chat(
    message: string,
    options?: { model?: string; conversationId?: string; parentMessageId?: string },
  ): Promise<ChatGPTResponse> {
    if (!this.session) throw new Error('No session. Run `webctl chatgpt login` first.');

    const body = JSON.stringify({
      action: 'next',
      messages: [
        {
          id: randomUUID(),
          role: 'user',
          content: {
            content_type: 'text',
            parts: [message],
          },
        },
      ],
      conversation_id: options?.conversationId ?? undefined,
      parent_message_id: options?.parentMessageId ?? randomUUID(),
      model: options?.model ?? 'auto',
      stream: true,
    });

    const { statusCode, body: resBody } = await request(CONVERSATION_URL, {
      method: 'POST',
      headers: this.buildHeaders({ accept: 'text/event-stream' }),
      body,
      dispatcher: this.agent,
      headersTimeout: 60_000,
      bodyTimeout: 120_000,
    });

    const text = await resBody.text();

    if (statusCode === 401) {
      throw new Error('Access token expired. Run `webctl chatgpt login` to refresh.');
    }
    if (statusCode === 403) {
      throw new Error(`ChatGPT HTTP 403 — account may be banned: ${text.slice(0, 200)}`);
    }
    if (statusCode === 429) {
      throw new Error('Rate limited. Wait before trying again.');
    }
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`ChatGPT HTTP ${statusCode}: ${text.slice(0, 200)}`);
    }

    return parseSSEStream(text);
  }

  async models(): Promise<ChatGPTModel[]> {
    if (!this.session) throw new Error('No session. Run `webctl chatgpt login` first.');

    const { statusCode, body: resBody } = await request(MODELS_URL, {
      method: 'GET',
      headers: this.buildHeaders(),
      dispatcher: this.agent,
    });

    const text = await resBody.text();

    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`ChatGPT HTTP ${statusCode}: ${text.slice(0, 200)}`);
    }

    const data = JSON.parse(text) as {
      models: Array<{
        slug: string;
        title: string;
        description: string;
        max_tokens: number;
        tags: string[];
      }>;
    };

    return data.models.map(m => ({
      slug: m.slug,
      title: m.title,
      description: m.description,
      maxTokens: m.max_tokens,
      tags: m.tags,
    }));
  }

  async dispose(): Promise<void> {
    await this.agent.close();
  }

  private async refreshAccessToken(): Promise<boolean> {
    if (!this.session) return false;

    try {
      const { statusCode, body: resBody } = await request(SESSION_URL, {
        method: 'GET',
        headers: {
          'User-Agent': this.session.userAgent || DEFAULT_UA,
          'Cookie': this.session.cookies,
        },
        dispatcher: this.agent,
      });

      const text = await resBody.text();
      if (statusCode !== 200) return false;

      const data = JSON.parse(text) as { accessToken?: string; expires?: string };
      if (!data.accessToken) return false;

      // Parse expiry from JWT or response
      let expiry = 0;
      if (data.expires) {
        expiry = new Date(data.expires).getTime();
      }
      if (!expiry) {
        // Try JWT payload
        const parts = data.accessToken.split('.');
        if (parts.length === 3 && parts[1]) {
          try {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as { exp?: number };
            if (payload.exp) expiry = payload.exp * 1000;
          } catch { /* use fallback */ }
        }
      }
      if (!expiry) {
        expiry = Date.now() + 60 * 60 * 1000; // 1hr fallback
      }

      this.session = {
        ...this.session,
        accessToken: data.accessToken,
        accessTokenExpiry: expiry,
      };
      return true;
    } catch {
      return false;
    }
  }

  private buildHeaders(opts?: { accept?: string }): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.session!.accessToken}`,
      'User-Agent': this.session!.userAgent || DEFAULT_UA,
      'Accept': opts?.accept ?? 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': BASE_URL,
      'Referer': `${BASE_URL}/`,
      'oai-device-id': this.session!.deviceId,
      'oai-language': 'en-US',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'sec-ch-ua': '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
    };
  }
}
