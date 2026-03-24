/**
 * Gemini response parser — Boq length-prefixed JSON format.
 */

import type { GeminiResponse, GeminiImage } from './types.js';

const IMAGE_SEARCH_MAX_DEPTH = 15;

function getNestedValue(data: unknown, path: ReadonlyArray<number | string>): unknown {
  let current: unknown = data;
  for (const key of path) {
    if (current === null || current === undefined) return undefined;
    if (typeof key === 'number' && Array.isArray(current)) {
      current = current[key];
    } else if (typeof key === 'string' && typeof current === 'object') {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return current;
}

export function stripSafetyPrefix(raw: string): string {
  return raw.replace(/^\s*\)]\}'\s*\n?/, '').trim();
}

export function extractJsonChunks(body: string): unknown[][] {
  const chunks: unknown[][] = [];
  const lines = body.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]?.trim();
    if (!line) { i++; continue; }

    if (/^\d+$/.test(line)) {
      const length = parseInt(line, 10);
      const nextLine = lines[i + 1];
      if (nextLine?.trim()) {
        try {
          chunks.push(JSON.parse(nextLine.trim()) as unknown[]);
          i += 2;
          continue;
        } catch { /* fall through */ }
      }

      let jsonStr = '';
      let j = i + 1;
      while (j < lines.length && jsonStr.length < length) {
        jsonStr += (jsonStr ? '\n' : '') + lines[j];
        j++;
      }
      if (jsonStr.trim()) {
        try { chunks.push(JSON.parse(jsonStr) as unknown[]); } catch { /* skip */ }
      }
      i = j;
    } else {
      try { chunks.push(JSON.parse(line) as unknown[]); } catch { /* skip */ }
      i++;
    }
  }
  return chunks;
}

export function parseEnvelopes(raw: string): unknown[][] {
  const stripped = stripSafetyPrefix(raw);
  const chunks = extractJsonChunks(stripped);
  const results: unknown[][] = [];

  for (const chunk of chunks) {
    if (!Array.isArray(chunk)) continue;
    for (const env of chunk) {
      if (!Array.isArray(env) || env[0] !== 'wrb.fr') continue;
      if (typeof env[2] === 'string') {
        try {
          const parsed = JSON.parse(env[2]) as unknown[];
          if (Array.isArray(parsed)) results.push(parsed);
        } catch { /* skip */ }
      }
    }
  }
  return results;
}

interface ConversationIds {
  conversationId: string;
  responseId: string;
  choiceId: string;
  stateToken: string;
}

function extractConversationIds(env: unknown[]): Partial<ConversationIds> {
  const ids: Partial<ConversationIds> = {};

  if (Array.isArray(env[1])) {
    const arr = env[1];
    if (typeof arr[0] === 'string' && (arr[0] as string).startsWith('c_')) ids.conversationId = arr[0] as string;
    if (typeof arr[1] === 'string' && (arr[1] as string).startsWith('r_')) ids.responseId = arr[1] as string;
  }

  const env4 = env[4];
  if (Array.isArray(env4) && Array.isArray((env4 as unknown[])[0])) {
    const candidate = (env4 as unknown[])[0] as unknown[];
    if (typeof candidate[0] === 'string' && (candidate[0] as string).startsWith('rc_')) {
      ids.choiceId = candidate[0] as string;
    }
  }

  if (env[2] && typeof env[2] === 'object' && !Array.isArray(env[2])) {
    const meta = env[2] as Record<string, unknown>;
    if (typeof meta['26'] === 'string') ids.stateToken = meta['26'];
  }

  return ids;
}

function findImageObjects(data: unknown, depth = 0): GeminiImage[] {
  if (depth > IMAGE_SEARCH_MAX_DEPTH || !Array.isArray(data)) return [];

  if (
    data.length >= 4 &&
    typeof data[3] === 'string' &&
    data[3].includes('lh3.googleusercontent.com')
  ) {
    const dims = Array.isArray(data[15]) ? data[15] as number[] : [];
    return [{
      url: data[3],
      filename: typeof data[2] === 'string' ? data[2] : 'image.png',
      mimeType: typeof data[11] === 'string' ? data[11] : 'image/png',
      width: dims[0] ?? 0,
      height: dims[1] ?? 0,
      size: dims[2] ?? 0,
      aqToken: typeof data[5] === 'string' && data[5].startsWith('$AQ') ? data[5] : undefined,
    }];
  }

  const results: GeminiImage[] = [];
  for (const item of data) {
    results.push(...findImageObjects(item, depth + 1));
  }
  return results;
}

function findAiDescription(env: unknown[]): string | undefined {
  const desc = getNestedValue(env, [26, 0, 0, 0, 9, 0, 0, 3, 1]);
  return typeof desc === 'string' && desc.length > 10 ? desc : undefined;
}

export function parseStreamGenerateResponse(raw: string): GeminiResponse & { stateToken: string } {
  const empty = { text: '', conversationId: '', responseId: '', choiceId: '', stateToken: '', images: [] as GeminiImage[], raw: raw ?? '' };
  if (!raw?.trim()) return empty;

  const stripped = stripSafetyPrefix(raw);
  const chunks = extractJsonChunks(stripped);

  if (chunks.length === 0) {
    try {
      const parsed = JSON.parse(stripped);
      if (Array.isArray(parsed)) chunks.push(parsed as unknown[]);
    } catch { return empty; }
  }

  let text = '';
  let conversationId = '';
  let responseId = '';
  let choiceId = '';
  let stateToken = '';
  let images: GeminiImage[] = [];

  for (const chunk of chunks) {
    if (!Array.isArray(chunk)) continue;
    for (const envelope of chunk) {
      if (!Array.isArray(envelope) || envelope[0] !== 'wrb.fr') continue;
      const innerJson = envelope[2];
      if (typeof innerJson !== 'string') continue;

      try {
        const innerData = JSON.parse(innerJson) as unknown[];
        if (!Array.isArray(innerData)) continue;

        const ids = extractConversationIds(innerData);
        if (ids.conversationId) conversationId = ids.conversationId;
        if (ids.responseId) responseId = ids.responseId;
        if (ids.choiceId) choiceId = ids.choiceId;
        if (ids.stateToken) stateToken = ids.stateToken;

        if (Array.isArray(innerData[4]) && Array.isArray(innerData[4][0])) {
          const candidate = innerData[4][0] as unknown[];
          if (Array.isArray(candidate[1]) && typeof candidate[1][0] === 'string') {
            const candidateText = candidate[1][0] as string;
            if (candidateText.length > text.length) text = candidateText;
          }
          const foundImages = findImageObjects(candidate);
          if (foundImages.length > 0) images = foundImages;

          const aiDesc = findAiDescription(innerData);
          if (aiDesc && images.length > 0) {
            for (const img of images) {
              if (!img.aiDescription) img.aiDescription = aiDesc;
            }
          }
        }
      } catch { /* skip */ }
    }
  }

  if (images.length > 0 && text) {
    text = text.replace(/https?:\/\/googleusercontent\.com\/image_generation_content\/\d+/g, '').trim();
  }

  return { text, conversationId, responseId, choiceId, stateToken, images, raw };
}
