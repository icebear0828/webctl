/**
 * ChatGPT SSE response parser.
 *
 * ChatGPT streams responses as Server-Sent Events (text/event-stream).
 * Each event line is `data: {json}`, terminated by `data: [DONE]`.
 *
 * We extract the final assistant message from the stream.
 */

import type { ChatGPTResponse } from './types.js';

interface SSEMessage {
  conversation_id?: string;
  message?: {
    id?: string;
    author?: { role?: string };
    content?: {
      content_type?: string;
      parts?: unknown[];
    };
    metadata?: {
      model_slug?: string;
    };
  };
  error?: string;
}

export function parseSSEStream(raw: string): ChatGPTResponse {
  const lines = raw.split('\n');
  let conversationId = '';
  let messageId = '';
  let model = '';
  let text = '';

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (payload === '[DONE]') break;

    let parsed: SSEMessage;
    try {
      parsed = JSON.parse(payload) as SSEMessage;
    } catch {
      continue;
    }

    if (parsed.error) {
      throw new Error(`ChatGPT error: ${parsed.error}`);
    }

    if (parsed.conversation_id) {
      conversationId = parsed.conversation_id;
    }

    const msg = parsed.message;
    if (!msg || msg.author?.role !== 'assistant') continue;
    if (msg.content?.content_type !== 'text') continue;

    // Each SSE event contains the full text so far (not a delta)
    const parts = msg.content.parts;
    if (Array.isArray(parts) && typeof parts[0] === 'string') {
      text = parts[0];
    }

    if (msg.id) messageId = msg.id;
    if (msg.metadata?.model_slug) model = msg.metadata.model_slug;
  }

  return { text, conversationId, messageId, model };
}
