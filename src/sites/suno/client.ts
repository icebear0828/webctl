/**
 * Suno HTTP client — undici + Chrome TLS fingerprint.
 *
 * Auth: Clerk JWT (Bearer) + Browser-Token (timestamp-based) + Device-Id.
 * Session refresh: POST auth.suno.com/v1/client/sessions/{id}/touch (cookie auth).
 *
 * Generate flow:
 *   1. POST /api/c/check → {required: bool}
 *   2. POST /api/generate/v2-web/ → batch + clip IDs
 *   3. Poll POST /api/feed/v3 until status=complete
 *
 * Download flow (WAV):
 *   1. POST /api/gen/{id}/convert_wav/
 *   2. GET  /api/gen/{id}/wav_file/ → {wav_file_url}
 *   3. GET  cdn1.suno.ai/{id}.wav
 */

import { request, type Agent } from 'undici';
import { randomUUID } from 'node:crypto';
import type { SunoSession, SunoClip, SunoGenerateResponse, SunoClipStatus } from './types.js';
import type { SessionStore } from '../../core/session.js';
import { createChromeTlsAgent } from '../../core/tls.js';

const STUDIO_BASE = 'https://studio-api-prod.suno.com';
const AUTH_BASE = 'https://auth.suno.com';

const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 5 * 60_000;

function buildBrowserToken(): string {
  const inner = Buffer.from(JSON.stringify({ timestamp: Date.now() })).toString('base64');
  return JSON.stringify({ token: inner });
}

function parseJwtExpiry(jwt: string): number {
  try {
    const parts = jwt.split('.');
    if (parts.length === 3 && parts[1]) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as { exp?: number };
      if (payload.exp) return payload.exp * 1000;
    }
  } catch { /* ignore */ }
  return Date.now() + 60 * 60 * 1000;
}

function parseClip(raw: Record<string, unknown>): SunoClip {
  const meta = (raw['metadata'] ?? {}) as Record<string, unknown>;
  return {
    id: raw['id'] as string,
    status: raw['status'] as SunoClipStatus,
    title: (raw['title'] as string) || '',
    audioUrl: (raw['audio_url'] as string) || '',
    imageUrl: (raw['image_url'] as string) || '',
    tags: (meta['tags'] as string) || '',
    prompt: (meta['prompt'] as string) || '',
    modelVersion: (raw['major_model_version'] as string) || '',
    duration: (raw['duration'] as number) ?? null,
  };
}

export class SunoClient {
  private session: SunoSession | null = null;
  private store: SessionStore<SunoSession>;
  private agent: Agent;

  constructor(store: SessionStore<SunoSession>) {
    this.store = store;
    this.agent = createChromeTlsAgent();
  }

  async loadSession(userId?: string): Promise<boolean> {
    this.session = await this.store.load(userId);
    if (!this.session) return false;

    // Refresh JWT if within 5 min of expiry
    if (Date.now() > this.session.jwtExpiry - 5 * 60 * 1000) {
      const refreshed = await this.refreshJwt();
      if (!refreshed) return false;
      await this.store.save(this.session, userId);
    }

    return true;
  }

  async generate(params: {
    prompt: string;
    tags?: string;
    title?: string;
    instrumental?: boolean;
    mv?: string;
    captchaToken?: string;
  }): Promise<SunoGenerateResponse> {
    if (!this.session) throw new Error('No session. Run `webctl suno login` first.');

    // Check captcha requirement
    const checkResp = await this.apiPost<{ required: boolean }>('/api/c/check', { ctype: 'generation' });
    if (checkResp.required && !params.captchaToken) {
      throw new Error('Suno requires captcha challenge on this IP. Try from a different IP or pass --captcha-token.');
    }

    const body: Record<string, unknown> = {
      generation_type: 'TEXT',
      title: params.title ?? '',
      tags: params.tags ?? '',
      negative_tags: '',
      mv: params.mv ?? 'chirp-fenix',
      prompt: params.prompt,
      make_instrumental: params.instrumental ?? false,
      user_uploaded_images_b64: null,
      metadata: {
        web_client_pathname: '/create',
        is_max_mode: false,
        is_mumble: false,
        create_mode: 'custom',
        disable_volume_normalization: false,
        create_session_token: randomUUID(),
      },
      override_fields: [],
      cover_clip_id: null,
      cover_start_s: null,
      cover_end_s: null,
      persona_id: null,
      artist_clip_id: null,
      artist_start_s: null,
      artist_end_s: null,
      continue_clip_id: null,
      continued_aligned_prompt: null,
      continue_at: null,
      transaction_uuid: randomUUID(),
    };

    if (params.captchaToken) {
      body['token'] = params.captchaToken;
    }

    const resp = await this.apiPost<{
      id: string;
      clips: Array<Record<string, unknown>>;
    }>('/api/generate/v2-web/', body);

    return {
      batchId: resp.id,
      clips: resp.clips.map(parseClip),
    };
  }

  async pollClips(clipIds: string[]): Promise<SunoClip[]> {
    if (!this.session) throw new Error('No session.');

    const resp = await this.apiPost<{ clips: Array<Record<string, unknown>> }>('/api/feed/v3', {
      filters: {
        ids: {
          presence: 'True',
          clipIds,
        },
      },
      limit: clipIds.length,
    });

    return resp.clips.map(parseClip);
  }

  async waitForCompletion(clipIds: string[], timeoutMs = POLL_TIMEOUT_MS): Promise<SunoClip[]> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const clips = await this.pollClips(clipIds);
      const allDone = clips.every(c => c.status === 'complete' || c.status === 'error');
      if (allDone) return clips;
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }

    throw new Error(`Timed out waiting for clips to complete (${timeoutMs / 1000}s)`);
  }

  async getWavUrl(clipId: string): Promise<string> {
    if (!this.session) throw new Error('No session.');

    // Trigger server-side WAV conversion
    await this.apiPost<unknown>(`/api/gen/${clipId}/convert_wav/`, {});

    // Wait briefly then fetch the URL
    await new Promise(r => setTimeout(r, 2_000));

    const resp = await this.apiGet<{ wav_file_url: string }>(`/api/gen/${clipId}/wav_file/`);
    return resp.wav_file_url;
  }

  async trackDownload(clipId: string): Promise<void> {
    if (!this.session) throw new Error('No session.');
    await this.apiPost<unknown>(`/api/billing/clips/${clipId}/download/`, {});
  }

  async incrementActionCount(clipId: string): Promise<void> {
    if (!this.session) throw new Error('No session.');
    await this.apiPost<unknown>(`/api/gen/${clipId}/increment_action_count/`, {});
  }

  async dispose(): Promise<void> {
    await this.agent.close();
  }

  private async refreshJwt(): Promise<boolean> {
    if (!this.session) return false;

    try {
      const url = `${AUTH_BASE}/v1/client/sessions/${this.session.sessionId}/touch?__clerk_api_version=2025-11-10&_clerk_js_version=5.117.0`;
      const { statusCode, body: resBody } = await request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': this.session.authCookies,
          'User-Agent': this.session.userAgent || DEFAULT_UA,
          'Referer': 'https://suno.com/',
          'Origin': 'https://suno.com',
          'sec-ch-ua': '"Not-A.Brand";v="24", "Chromium";v="146"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"macOS"',
        },
        body: '',
        dispatcher: this.agent,
      });

      const text = await resBody.text();
      if (statusCode !== 200) return false;

      const data = JSON.parse(text) as {
        response?: {
          last_active_token?: { jwt?: string };
        };
      };

      const jwt = data.response?.last_active_token?.jwt;
      if (!jwt) return false;

      this.session = {
        ...this.session,
        jwt,
        jwtExpiry: parseJwtExpiry(jwt),
      };
      return true;
    } catch {
      return false;
    }
  }

  private buildHeaders(): Record<string, string> {
    const s = this.session!;
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${s.jwt}`,
      'Browser-Token': buildBrowserToken(),
      'Device-Id': s.deviceId,
      'User-Agent': s.userAgent || DEFAULT_UA,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Origin': 'https://suno.com',
      'Referer': 'https://suno.com/',
      'sec-ch-ua': '"Not-A.Brand";v="24", "Chromium";v="146"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
    };
  }

  private async apiPost<T>(path: string, body: unknown): Promise<T> {
    const { statusCode, body: resBody } = await request(`${STUDIO_BASE}${path}`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      dispatcher: this.agent,
      headersTimeout: 30_000,
      bodyTimeout: 60_000,
    });

    const text = await resBody.text();
    if (statusCode === 401) throw new Error('JWT expired. Run `webctl suno login` to refresh.');
    if (statusCode === 429) throw new Error('Rate limited by Suno.');
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`Suno API POST ${path} HTTP ${statusCode}: ${text.slice(0, 300)}`);
    }

    return (text ? JSON.parse(text) : {}) as T;
  }

  private async apiGet<T>(path: string): Promise<T> {
    const { statusCode, body: resBody } = await request(`${STUDIO_BASE}${path}`, {
      method: 'GET',
      headers: this.buildHeaders(),
      dispatcher: this.agent,
      headersTimeout: 30_000,
      bodyTimeout: 30_000,
    });

    const text = await resBody.text();
    if (statusCode === 401) throw new Error('JWT expired. Run `webctl suno login` to refresh.');
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`Suno API GET ${path} HTTP ${statusCode}: ${text.slice(0, 300)}`);
    }

    return JSON.parse(text) as T;
  }
}
