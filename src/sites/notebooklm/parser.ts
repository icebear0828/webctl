/**
 * NotebookLM RPC response parsers.
 * Reuses Boq envelope parsing from Gemini.
 */

import { parseEnvelopes } from '../gemini/parser.js';
import type { NotebookInfo, SourceInfo, ArtifactInfo, StudioConfig, QuotaInfo, ResearchResult } from './types.js';

// ── Helpers ──

function get(data: unknown, ...path: number[]): unknown {
  let current: unknown = data;
  for (const idx of path) {
    if (!Array.isArray(current)) return undefined;
    current = current[idx];
  }
  return current;
}

function getString(data: unknown, ...path: number[]): string {
  const val = get(data, ...path);
  return typeof val === 'string' ? val : '';
}

function getArray(data: unknown, ...path: number[]): unknown[] | null {
  const val = get(data, ...path);
  return Array.isArray(val) ? val : null;
}

function extractInner(raw: string): unknown {
  const envelopes = parseEnvelopes(raw);
  return envelopes.length > 0 ? envelopes[0] : null;
}

function extractAllInner(raw: string): unknown[] {
  return parseEnvelopes(raw);
}

// ── Notebook CRUD ──

export function parseCreateNotebook(raw: string): { notebookId: string } {
  const inner = extractInner(raw);
  const id = getString(inner, 2);
  if (!id) throw new Error('Failed to parse notebook ID from create response');
  return { notebookId: id };
}

export function parseListNotebooks(raw: string): NotebookInfo[] {
  const inner = extractInner(raw);
  if (!Array.isArray(inner)) return [];

  const entries = Array.isArray(inner[0]) ? inner[0] as unknown[] : inner;
  const notebooks: NotebookInfo[] = [];

  for (const entry of entries) {
    if (!Array.isArray(entry)) continue;
    const title = typeof entry[0] === 'string' ? entry[0] : '';
    const id = typeof entry[2] === 'string' ? entry[2] : '';
    if (id && /^[0-9a-f]{8}-/.test(id)) {
      const sourceCount = Array.isArray(entry[1]) ? entry[1].length : undefined;
      notebooks.push({ id, title, sourceCount });
    }
  }
  return notebooks;
}

export function parseNotebookDetail(raw: string): { title: string; sources: SourceInfo[] } {
  const inner = extractInner(raw);
  if (!Array.isArray(inner)) return { title: '', sources: [] };

  const entry = Array.isArray(inner[0]) ? inner[0] as unknown[] : inner;
  const title = typeof entry[0] === 'string' ? entry[0] : '';
  const sources: SourceInfo[] = [];
  const sourcesArr = Array.isArray(entry[1]) ? entry[1] as unknown[] : [];

  for (const srcEntry of sourcesArr) {
    if (!Array.isArray(srcEntry)) continue;
    let id = '';
    const first = srcEntry[0];
    if (Array.isArray(first) && typeof first[0] === 'string') id = first[0];
    const sourceTitle = typeof srcEntry[1] === 'string' ? srcEntry[1] : '';

    if (id) {
      const meta = Array.isArray(srcEntry[2]) ? srcEntry[2] as unknown[] : [];
      const wordCount = typeof meta[1] === 'number' ? meta[1] : undefined;
      let url: string | undefined;
      if (Array.isArray(meta[7]) && typeof meta[7][0] === 'string') url = meta[7][0];
      else if (typeof meta[7] === 'string') url = meta[7];
      sources.push({ id, title: sourceTitle, wordCount, url });
    }
  }
  return { title, sources };
}

// ── Source Parsers ──

export function parseAddSource(raw: string): { sourceId: string; title: string } {
  const inner = extractInner(raw);
  const entry = getArray(inner, 0, 0);
  if (!entry) return { sourceId: '', title: '' };
  const idArr = getArray(entry, 0);
  const id = idArr && typeof idArr[0] === 'string' ? idArr[0] : '';
  const title = getString(entry, 1);
  return { sourceId: id, title };
}

export function parseSourceSummary(raw: string): { sourceId: string; summary: string } {
  const inner = extractInner(raw);
  if (!Array.isArray(inner)) return { sourceId: '', summary: '' };
  const sourceId = getString(inner, 0, 0, 0, 0);
  const summary = typeof inner[1] === 'string' ? inner[1] : '';
  return { sourceId, summary };
}

// ── Artifact Parsers ──

export function parseGenerateArtifact(raw: string): { artifactId: string; title: string } {
  const inner = extractInner(raw);
  if (!Array.isArray(inner)) return { artifactId: '', title: '' };
  const entry = Array.isArray(inner[0]) ? inner[0] as unknown[] : inner;
  const artifactId = typeof entry[0] === 'string' ? entry[0] : '';
  const title = typeof entry[1] === 'string' ? entry[1] : '';
  return { artifactId, title };
}

export function parseArtifacts(raw: string): ArtifactInfo[] {
  const inner = extractInner(raw);
  if (!Array.isArray(inner)) return [];

  let entries: unknown[] = inner;
  if (entries.length === 1 && Array.isArray(entries[0])) entries = entries[0] as unknown[];

  const artifacts: ArtifactInfo[] = [];
  for (const rawEntry of entries) {
    if (!Array.isArray(rawEntry)) continue;
    const entry: unknown[] = (rawEntry.length === 1 && Array.isArray(rawEntry[0]))
      ? rawEntry[0] as unknown[] : rawEntry;

    const id = typeof entry[0] === 'string' ? entry[0] : '';
    const title = typeof entry[1] === 'string' ? entry[1] : '';
    const type = typeof entry[2] === 'number' ? entry[2] : 0;
    if (!id) continue;

    const artifact: ArtifactInfo = { id, title, type };

    const sourceIdsRaw = getArray(entry, 3);
    if (sourceIdsRaw) {
      artifact.sourceIds = [];
      for (const sid of sourceIdsRaw) {
        if (Array.isArray(sid) && Array.isArray(sid[0]) && typeof sid[0][0] === 'string') {
          artifact.sourceIds.push(sid[0][0]);
        } else if (Array.isArray(sid) && typeof sid[0] === 'string') {
          artifact.sourceIds.push(sid[0]);
        }
      }
    }

    const mediaUrls = findMediaUrls(entry);
    if (mediaUrls.download) artifact.downloadUrl = mediaUrls.download;
    if (mediaUrls.stream) artifact.streamUrl = mediaUrls.stream;
    if (mediaUrls.hls) artifact.hlsUrl = mediaUrls.hls;
    if (mediaUrls.dash) artifact.dashUrl = mediaUrls.dash;
    if (mediaUrls.durationSeconds !== undefined) artifact.durationSeconds = mediaUrls.durationSeconds;

    artifacts.push(artifact);
  }
  return artifacts;
}

interface MediaUrls {
  download?: string;
  stream?: string;
  hls?: string;
  dash?: string;
  durationSeconds?: number;
}

function findMediaUrls(data: unknown, depth = 0): MediaUrls {
  if (depth > 12 || data === null || data === undefined) return {};
  if (!Array.isArray(data)) return {};

  if (data.length === 2 && typeof data[0] === 'number' && typeof data[1] === 'number'
      && data[0] > 10 && data[0] < 100000 && data[1] > 1000000) {
    return { durationSeconds: data[0] };
  }

  if (data.length >= 2 && Array.isArray(data[0])) {
    const first = data[0];
    if (typeof first[0] === 'string' && first[0].includes('googleusercontent.com/notebooklm/')) {
      const result: MediaUrls = {};
      for (const variant of data) {
        if (!Array.isArray(variant) || typeof variant[0] !== 'string') continue;
        const url = variant[0] as string;
        const typeCode = variant[1];
        if (url.includes('=m140-dv') || typeCode === 4) result.download = url;
        else if (url.includes('=m140') || typeCode === 1) result.stream = url;
        else if (url.includes('=mm,hls') || typeCode === 2) result.hls = url;
        else if (url.includes('=mm,dash') || typeCode === 3) result.dash = url;
      }
      return result;
    }
  }

  const merged: MediaUrls = {};
  for (const item of data) {
    Object.assign(merged, findMediaUrls(item, depth + 1));
  }
  return merged;
}

// ── Chat Parser ──

export function parseChatStream(raw: string): { text: string; threadId: string; responseId: string } {
  const inners = extractAllInner(raw);
  let lastText = '';
  let threadId = '';
  let responseId = '';

  for (const inner of inners) {
    if (!Array.isArray(inner)) continue;
    const payload = Array.isArray(inner[0]) ? inner[0] as unknown[] : inner;
    const text = typeof payload[0] === 'string' ? payload[0] : '';
    if (text) lastText = text;

    const meta = getArray(payload, 2);
    if (meta) {
      if (typeof meta[0] === 'string' && meta[0]) threadId = meta[0];
      if (typeof meta[1] === 'string' && meta[1]) responseId = meta[1];
    }
  }
  return { text: lastText, threadId, responseId };
}

// ── Config & Quota ──

export function parseStudioConfig(raw: string): StudioConfig {
  const inner = extractInner(raw);
  if (!Array.isArray(inner)) return { audioTypes: [], explainerTypes: [], slideTypes: [], docTypes: [] };

  const sections = Array.isArray(inner[0]) ? inner[0] as unknown[] : inner;

  function parseTyped(section: unknown): Array<{ id: number; name: string; description: string }> {
    if (!Array.isArray(section) || !Array.isArray(section[0])) return [];
    return (section[0] as unknown[]).filter(Array.isArray).map((arr: unknown) => {
      const a = arr as unknown[];
      return { id: typeof a[0] === 'number' ? a[0] : 0, name: typeof a[1] === 'string' ? a[1] : '', description: typeof a[2] === 'string' ? a[2] : '' };
    });
  }

  function parseDoc(section: unknown): Array<{ name: string; description: string }> {
    if (!Array.isArray(section) || !Array.isArray(section[0])) return [];
    return (section[0] as unknown[]).filter(Array.isArray).map((arr: unknown) => {
      const a = arr as unknown[];
      return { name: typeof a[0] === 'string' ? a[0] : '', description: typeof a[1] === 'string' ? a[1] : '' };
    });
  }

  return {
    audioTypes: parseTyped(sections[0]),
    explainerTypes: parseTyped(sections[1]),
    slideTypes: parseTyped(sections[2]),
    docTypes: parseDoc(sections[3]),
  };
}

export function parseQuota(raw: string): QuotaInfo {
  const inner = extractInner(raw);
  if (!Array.isArray(inner)) return { audioRemaining: 0, audioLimit: 0, notebookLimit: 0, sourceWordLimit: 0 };
  const entry = Array.isArray(inner[0]) && !Array.isArray(inner[1]) ? inner[0] as unknown[] : inner;
  const limits = Array.isArray(entry[1]) ? entry[1] as number[] : [];
  return {
    audioRemaining: typeof limits[0] === 'number' ? limits[0] : 0,
    audioLimit: typeof limits[1] === 'number' ? limits[1] : 0,
    notebookLimit: typeof limits[2] === 'number' ? limits[2] : 0,
    sourceWordLimit: typeof limits[3] === 'number' ? limits[3] : 0,
  };
}

export function parseResearchResults(raw: string): { status: number; results: ResearchResult[] } {
  const inner = extractInner(raw);
  if (!Array.isArray(inner)) return { status: 0, results: [] };

  const outerList = getArray(inner, 0);
  if (!outerList) return { status: 0, results: [] };

  const wrapper = Array.isArray(outerList[0]) ? outerList[0] as unknown[] : outerList;
  let entryArr: unknown[] | null = null;
  if (typeof wrapper[0] === 'string') entryArr = wrapper;
  else if (Array.isArray(wrapper[0]) && typeof wrapper[0][0] === 'string') entryArr = wrapper[0] as unknown[];
  if (!entryArr) return { status: 0, results: [] };

  const meta = getArray(entryArr, 1);
  if (!meta) return { status: 0, results: [] };

  const status = typeof meta[4] === 'number' ? meta[4] : (typeof meta[2] === 'number' ? meta[2] : 0);
  const results: ResearchResult[] = [];
  let resultArr = getArray(meta, 3);
  if (resultArr) {
    if (resultArr.length > 0 && Array.isArray(resultArr[0]) && Array.isArray(resultArr[0][0])) {
      resultArr = resultArr[0] as unknown[];
    }
    for (const item of resultArr) {
      if (!Array.isArray(item)) continue;
      const url = typeof item[0] === 'string' ? item[0] : '';
      const title = typeof item[1] === 'string' ? item[1] : '';
      const description = typeof item[2] === 'string' ? item[2] : '';
      if (url) results.push({ url, title, description });
    }
  }
  return { status, results };
}

export { parseEnvelopes } from '../gemini/parser.js';
