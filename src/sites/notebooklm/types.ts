/**
 * NotebookLM type definitions.
 */

export type SourceType = 'url' | 'text' | 'research';
export type ResearchMode = 'fast' | 'deep';
export type AudioLanguage = 'en' | 'zh' | 'ja' | 'ko' | 'es' | 'fr' | 'de' | 'pt' | 'it' | 'hi';

export interface NotebookSession {
  /** CSRF token from WIZ_global_data.SNlM0e */
  at: string;
  /** boq version ID (boq_labs-tailwind-frontend_...) */
  bl: string;
  /** Session ID from WIZ_global_data.FdrFJe */
  fsid: string;
  /** Cookie string */
  cookies: string;
  /** Browser user agent */
  userAgent: string;
}

export interface NotebookInfo {
  id: string;
  title: string;
  sourceCount?: number;
}

export interface SourceInfo {
  id: string;
  title: string;
  wordCount?: number;
  url?: string;
}

export interface ArtifactInfo {
  id: string;
  title: string;
  type: number;
  downloadUrl?: string;
  streamUrl?: string;
  hlsUrl?: string;
  dashUrl?: string;
  durationSeconds?: number;
  sourceIds?: string[];
}

export interface StudioConfig {
  audioTypes: Array<{ id: number; name: string; description: string }>;
  explainerTypes: Array<{ id: number; name: string; description: string }>;
  slideTypes: Array<{ id: number; name: string; description: string }>;
  docTypes: Array<{ name: string; description: string }>;
}

export interface QuotaInfo {
  audioRemaining: number;
  audioLimit: number;
  notebookLimit: number;
  sourceWordLimit: number;
}

export interface ResearchResult {
  url: string;
  title: string;
  description: string;
}
