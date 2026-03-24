/**
 * Gemini type definitions.
 */

export interface GeminiSession {
  /** CSRF token from WIZ_global_data.SNlM0e */
  at: string;
  /** Version ID (boq_assistant-bard-web-server_...) */
  bl: string;
  /** Session ID from WIZ_global_data.FdrFJe */
  fsid: string;
  /** Cookie string */
  cookies: string;
  /** Browser user agent */
  userAgent: string;
  /** StreamGenerate service hash */
  serviceHash: string;
  /** Session hash for x-goog-ext header */
  sessionHash: string;
}

export interface GeminiImage {
  url: string;
  filename: string;
  mimeType: string;
  width: number;
  height: number;
  size: number;
  aqToken?: string;
  aiDescription?: string;
}

export interface GeminiResponse {
  text: string;
  conversationId: string;
  responseId: string;
  choiceId: string;
  images: GeminiImage[];
  raw: string;
}
