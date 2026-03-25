/**
 * Transport abstraction — HTTP-first, browser fallback.
 */

import { request, type Agent } from 'undici';
import { createChromeTlsAgent } from './tls.js';

export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
}

export interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: unknown;
  cookies?: Cookie[];
  timeout?: number;
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  cookies?: Cookie[];
}

export interface Transport {
  request(opts: RequestOptions): Promise<TransportResponse>;
  dispose(): Promise<void>;
}

export class HttpTransport implements Transport {
  private agent: Agent;

  constructor() {
    this.agent = createChromeTlsAgent();
  }

  async request(opts: RequestOptions): Promise<TransportResponse> {
    const headers: Record<string, string> = { ...opts.headers };

    if (opts.cookies?.length) {
      const cookieStr = opts.cookies.map(c => `${c.name}=${c.value}`).join('; ');
      headers['cookie'] = headers['cookie']
        ? `${headers['cookie']}; ${cookieStr}`
        : cookieStr;
    }

    let bodyStr: string | undefined;
    if (opts.body !== undefined) {
      if (typeof opts.body === 'string') {
        bodyStr = opts.body;
      } else {
        bodyStr = JSON.stringify(opts.body);
        headers['content-type'] ??= 'application/json';
      }
    }

    const { statusCode, headers: resHeaders, body: resBody } = await request(opts.url, {
      method: opts.method ?? 'GET',
      headers,
      body: bodyStr,
      dispatcher: this.agent,
      headersTimeout: opts.timeout ?? 30_000,
    });

    const text = await resBody.text();
    const contentType = (resHeaders['content-type'] as string | undefined) ?? '';

    let body: unknown;
    try {
      body = contentType.includes('application/json') ? JSON.parse(text) : text;
    } catch {
      body = text;
    }

    const responseHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(resHeaders)) {
      if (typeof v === 'string') responseHeaders[k] = v;
      else if (Array.isArray(v)) responseHeaders[k] = v.join(', ');
    }

    return { status: statusCode, headers: responseHeaders, body };
  }

  async dispose(): Promise<void> {
    await this.agent.close();
  }
}
