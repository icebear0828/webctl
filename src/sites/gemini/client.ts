/**
 * Gemini HTTP client — undici + Chrome TLS fingerprint.
 */

import { request, type Agent } from 'undici';
import type { GeminiSession, GeminiResponse } from './types.js';
import type { SessionStore } from '../../core/session.js';
import { createChromeTlsAgent } from '../../core/tls.js';
import { mergeCookies } from '../../core/cookies.js';
import { parseStreamGenerateResponse } from './parser.js';

const GEMINI_BASE = 'https://gemini.google.com';
const STREAM_GENERATE_URL = `${GEMINI_BASE}/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate`;
const APP_URL = `${GEMINI_BASE}/app`;

export class GeminiClient {
  private session: GeminiSession | null = null;
  private store: SessionStore<GeminiSession>;
  private agent: Agent;
  private reqCounter = 100000;

  constructor(store: SessionStore<GeminiSession>) {
    this.store = store;
    this.agent = createChromeTlsAgent();
  }

  async loadSession(userId?: string): Promise<boolean> {
    this.session = await this.store.load(userId);
    return this.session !== null;
  }

  async chat(message: string, conversationId?: string): Promise<GeminiResponse> {
    if (!this.session) throw new Error('No session. Run `webctl gemini login` first.');

    const innerPayload = [
      [message], [],
      conversationId ? [conversationId, '', ''] : null,
    ];
    const raw = await this.callStreamGenerate(innerPayload);
    const parsed = parseStreamGenerateResponse(raw);

    return {
      text: parsed.text,
      conversationId: parsed.conversationId,
      responseId: parsed.responseId,
      choiceId: parsed.choiceId,
      images: parsed.images,
      raw: parsed.raw,
    };
  }

  async dispose(): Promise<void> {
    await this.agent.close();
  }

  private async callStreamGenerate(innerPayload: unknown[]): Promise<string> {
    const session = this.session!;
    const reqId = this.nextReqId();

    const fReq = JSON.stringify([null, JSON.stringify(innerPayload)]);
    const body = new URLSearchParams({ 'f.req': fReq, at: session.at }).toString();

    const qp = new URLSearchParams({
      bl: session.bl, hl: 'en', _reqid: String(reqId), rt: 'c',
      ...(session.fsid ? { 'f.sid': session.fsid } : {}),
    });

    const { statusCode, body: resBody } = await request(
      `${STREAM_GENERATE_URL}?${qp.toString()}`,
      { method: 'POST', headers: this.buildHeaders(), body, dispatcher: this.agent },
    );

    const text = await resBody.text();

    if (statusCode === 401 || statusCode === 400) {
      await this.refreshSession();
      return this.callStreamGenerate(innerPayload);
    }

    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`Gemini HTTP ${statusCode}: ${text.slice(0, 200)}`);
    }

    return text;
  }

  private async refreshSession(): Promise<void> {
    const session = this.session!;

    const { statusCode, headers: resHeaders, body: resBody } = await request(APP_URL, {
      method: 'GET',
      headers: {
        'User-Agent': session.userAgent,
        'Cookie': session.cookies,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      dispatcher: this.agent,
    });

    const html = await resBody.text();

    if (statusCode !== 200 || html.includes('accounts.google.com/ServiceLogin')) {
      throw new Error('Session expired — cookies invalid. Run `webctl gemini login`.');
    }

    const atMatch = html.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
    const blMatch = html.match(/"cfb2h"\s*:\s*"([^"]+)"/);
    const fsidMatch = html.match(/"FdrFJe"\s*:\s*"([^"]+)"/);
    const atValue = atMatch?.[1];
    const blValue = blMatch?.[1];

    if (!atValue || !blValue) throw new Error('Failed to extract tokens from Gemini app HTML');
    if (!blValue.includes('assistant-bard')) throw new Error(`Unexpected bl: ${blValue.slice(0, 50)}`);

    let newServiceHash = session.serviceHash;
    const hashMatch = html.match(/"StreamGenerate"[^"]*"(![\w\-_+/=]+)"/);
    if (hashMatch?.[1]) newServiceHash = hashMatch[1];

    const setCookies = resHeaders['set-cookie'];
    const setCookieArr = Array.isArray(setCookies) ? setCookies : setCookies ? [setCookies] : [];
    const newCookies = setCookieArr.length > 0 ? mergeCookies(session.cookies, setCookieArr) : session.cookies;

    this.session = {
      at: atValue, bl: blValue, fsid: fsidMatch?.[1] ?? '',
      cookies: newCookies, userAgent: session.userAgent,
      serviceHash: newServiceHash, sessionHash: session.sessionHash,
    };

    await this.store.save(this.session);
  }

  private buildHeaders(): Record<string, string> {
    const session = this.session!;
    return {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent': session.userAgent,
      'Cookie': session.cookies,
      'Origin': GEMINI_BASE,
      'Referer': `${GEMINI_BASE}/`,
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'X-Same-Domain': '1',
    };
  }

  private nextReqId(): number {
    this.reqCounter += Math.floor(100000 + Math.random() * 100000);
    return this.reqCounter;
  }
}
