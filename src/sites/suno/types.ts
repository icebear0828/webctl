/**
 * Suno site adapter types.
 */

export interface SunoSession {
  /** Clerk JWT access token (Bearer) */
  jwt: string;
  /** JWT expiry timestamp (ms) */
  jwtExpiry: number;
  /** Clerk session ID — used for token refresh */
  sessionId: string;
  /** Cookies for auth.suno.com (Clerk) — needed for touch/refresh */
  authCookies: string;
  /** Cookies for suno.com / studio-api-prod.suno.com */
  siteCookies: string;
  /** suno_device_id cookie value */
  deviceId: string;
  userAgent: string;
}

export type SunoClipStatus = 'submitted' | 'queued' | 'streaming' | 'complete' | 'error';

export interface SunoClip {
  id: string;
  status: SunoClipStatus;
  title: string;
  audioUrl: string;
  imageUrl: string;
  tags: string;
  prompt: string;
  modelVersion: string;
  duration: number | null;
}

export interface SunoGenerateResponse {
  /** Batch ID */
  batchId: string;
  clips: SunoClip[];
}
