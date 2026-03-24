/**
 * Transport abstraction — HTTP-first, browser fallback.
 */

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
  async request(opts: RequestOptions): Promise<TransportResponse> {
    const headers: Record<string, string> = { ...opts.headers };

    if (opts.cookies?.length) {
      const cookieStr = opts.cookies.map(c => `${c.name}=${c.value}`).join('; ');
      headers['cookie'] = headers['cookie']
        ? `${headers['cookie']}; ${cookieStr}`
        : cookieStr;
    }

    let bodyInit: BodyInit | undefined;
    if (opts.body !== undefined) {
      if (typeof opts.body === 'string') {
        bodyInit = opts.body;
      } else {
        bodyInit = JSON.stringify(opts.body);
        headers['content-type'] ??= 'application/json';
      }
    }

    const controller = new AbortController();
    const timer = opts.timeout
      ? setTimeout(() => controller.abort(), opts.timeout)
      : undefined;

    try {
      const res = await fetch(opts.url, {
        method: opts.method ?? 'GET',
        headers,
        body: bodyInit,
        signal: controller.signal,
        redirect: 'follow',
      });

      const contentType = res.headers.get('content-type') ?? '';
      const body = contentType.includes('application/json')
        ? await res.json() as unknown
        : await res.text();

      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => { responseHeaders[k] = v; });

      return { status: res.status, headers: responseHeaders, body };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async dispose(): Promise<void> {
    // nothing to clean up
  }
}
