/**
 * Gemini HTTP client — pure Node.js, no browser dependency.
 */

import type { GeminiSession, GeminiResponse } from './types.js';
import type { SessionStore } from '../../core/session.js';
import { parseStreamGenerateResponse } from './parser.js';

const GEMINI_BASE = 'https://gemini.google.com';
const STREAM_GENERATE_URL = `${GEMINI_BASE}/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate`;
const APP_URL = `${GEMINI_BASE}/app`;

export class GeminiClient {
  private session: GeminiSession | null = null;
  private store: SessionStore<GeminiSession>;
  private reqCounter = 100000;

  constructor(store: SessionStore<GeminiSession>) {
    this.store = store;
  }

  async loadSession(userId?: string): Promise<boolean> {
    this.session = await this.store.load(userId);
    return this.session !== null;
  }

  async chat(message: string, conversationId?: string): Promise<GeminiResponse> {
    if (!this.session) {
      throw new Error('No session loaded. Run `webctl gemini auth login` first.');
    }

    const innerPayload = this.buildChatPayload(message, conversationId);
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

  private buildChatPayload(message: string, conversationId?: string): unknown[] {
    return [
      [message],
      [],
      conversationId ? [conversationId, '', ''] : null,
    ];
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

    const headers = this.buildHeaders();
    const fullUrl = `${STREAM_GENERATE_URL}?${qp.toString()}`;

    const res = await fetch(fullUrl, {
      method: 'POST',
      headers,
      body,
      redirect: 'follow',
    });

    const text = await res.text();

    if (res.status === 401 || res.status === 400) {
      // Try refresh
      const refreshed = await this.refreshSession();
      if (!refreshed) {
        throw new Error(`Gemini returned HTTP ${res.status}. Session expired — re-login required.`);
      }
      // Retry once
      return this.callStreamGenerate(innerPayload);
    }

    if (!res.ok) {
      throw new Error(`Gemini HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    return text;
  }

  private async refreshSession(): Promise<boolean> {
    const session = this.session!;

    const res = await fetch(APP_URL, {
      headers: {
        'User-Agent': session.userAgent,
        'Cookie': session.cookies,
        'Accept': 'text/html',
      },
      redirect: 'follow',
    });

    const html = await res.text();

    if (res.status !== 200 || html.includes('accounts.google.com/ServiceLogin')) {
      return false;
    }

    const atMatch = html.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
    const blMatch = html.match(/"cfb2h"\s*:\s*"([^"]+)"/);
    const fsidMatch = html.match(/"FdrFJe"\s*:\s*"([^"]+)"/);

    const atValue = atMatch?.[1];
    const blValue = blMatch?.[1];

    if (!atValue || !blValue) return false;
    if (!blValue.includes('assistant-bard')) return false;

    let newServiceHash = session.serviceHash;
    const hashMatch = html.match(/"StreamGenerate"[^"]*"(![\w\-_+/=]+)"/);
    if (hashMatch?.[1]) newServiceHash = hashMatch[1];

    // Merge Set-Cookie
    const setCookieHeader = res.headers.get('set-cookie');
    const newCookies = setCookieHeader
      ? mergeCookies(session.cookies, setCookieHeader)
      : session.cookies;

    this.session = {
      at: atValue,
      bl: blValue,
      fsid: fsidMatch?.[1] ?? '',
      cookies: newCookies,
      userAgent: session.userAgent,
      serviceHash: newServiceHash,
      sessionHash: session.sessionHash,
    };

    await this.store.save(this.session);
    return true;
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

function mergeCookies(existing: string, setCookie: string): string {
  const cookieMap = new Map<string, string>();

  for (const part of existing.split(';')) {
    const trimmed = part.trim();
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      cookieMap.set(trimmed.slice(0, eqIdx).trim(), trimmed.slice(eqIdx + 1).trim());
    }
  }

  for (const header of setCookie.split(',')) {
    const firstSemicolon = header.indexOf(';');
    const nameValue = firstSemicolon > 0 ? header.slice(0, firstSemicolon) : header;
    const eqIdx = nameValue.indexOf('=');
    if (eqIdx > 0) {
      cookieMap.set(nameValue.slice(0, eqIdx).trim(), nameValue.slice(eqIdx + 1).trim());
    }
  }

  return Array.from(cookieMap.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}
