import { describe, it, expect } from 'vitest';
import { HttpTransport } from '../../src/core/transport.js';

describe('HttpTransport', () => {
  it('makes a GET request', async () => {
    const transport = new HttpTransport();
    const res = await transport.request({
      url: 'https://httpbin.org/get',
    });
    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    await transport.dispose();
  });

  it('makes a POST request with JSON body', async () => {
    const transport = new HttpTransport();
    const res = await transport.request({
      url: 'https://httpbin.org/post',
      method: 'POST',
      body: { hello: 'world' },
    });
    expect(res.status).toBe(200);
    const body = res.body as { json: { hello: string } };
    expect(body.json.hello).toBe('world');
    await transport.dispose();
  });

  it('includes cookies in request', async () => {
    const transport = new HttpTransport();
    const res = await transport.request({
      url: 'https://httpbin.org/cookies',
      cookies: [{ name: 'test', value: 'value123' }],
    });
    expect(res.status).toBe(200);
    const body = res.body as { cookies: Record<string, string> };
    expect(body.cookies['test']).toBe('value123');
    await transport.dispose();
  });
});
