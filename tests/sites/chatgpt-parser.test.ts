import { describe, it, expect } from 'vitest';
import { parseSSEStream } from '../../src/sites/chatgpt/parser.js';

const SAMPLE_SSE = [
  'data: {"conversation_id":"conv-abc","message":{"id":"msg-1","author":{"role":"assistant"},"content":{"content_type":"text","parts":["Hi"]},"metadata":{"model_slug":"gpt-4o"}}}',
  'data: {"conversation_id":"conv-abc","message":{"id":"msg-1","author":{"role":"assistant"},"content":{"content_type":"text","parts":["Hi! How"]},"metadata":{"model_slug":"gpt-4o"}}}',
  'data: {"conversation_id":"conv-abc","message":{"id":"msg-1","author":{"role":"assistant"},"content":{"content_type":"text","parts":["Hi! How can I help?"]},"metadata":{"model_slug":"gpt-4o"}}}',
  'data: [DONE]',
].join('\n');

describe('ChatGPT Parser', () => {
  describe('parseSSEStream', () => {
    it('parses complete SSE response', () => {
      const result = parseSSEStream(SAMPLE_SSE);

      expect(result.conversationId).toBe('conv-abc');
      expect(result.text).toBe('Hi! How can I help?');
      expect(result.messageId).toBe('msg-1');
      expect(result.model).toBe('gpt-4o');
    });

    it('ignores non-assistant messages', () => {
      const sse = [
        'data: {"conversation_id":"conv-1","message":{"id":"u-1","author":{"role":"user"},"content":{"content_type":"text","parts":["hello"]}}}',
        'data: {"conversation_id":"conv-1","message":{"id":"a-1","author":{"role":"assistant"},"content":{"content_type":"text","parts":["world"]},"metadata":{"model_slug":"gpt-4o"}}}',
        'data: [DONE]',
      ].join('\n');

      const result = parseSSEStream(sse);
      expect(result.text).toBe('world');
    });

    it('ignores non-text content types', () => {
      const sse = [
        'data: {"conversation_id":"conv-1","message":{"id":"a-1","author":{"role":"assistant"},"content":{"content_type":"code","parts":["print(1)"]}}}',
        'data: {"conversation_id":"conv-1","message":{"id":"a-2","author":{"role":"assistant"},"content":{"content_type":"text","parts":["Done"]},"metadata":{"model_slug":"gpt-4o"}}}',
        'data: [DONE]',
      ].join('\n');

      const result = parseSSEStream(sse);
      expect(result.text).toBe('Done');
    });

    it('throws on error in stream', () => {
      const sse = 'data: {"error":"Too many requests"}\n';

      expect(() => parseSSEStream(sse)).toThrow('ChatGPT error: Too many requests');
    });

    it('handles empty input', () => {
      const result = parseSSEStream('');
      expect(result.text).toBe('');
      expect(result.conversationId).toBe('');
    });

    it('handles malformed lines gracefully', () => {
      const sse = [
        'data: not json',
        'data: {"conversation_id":"conv-1","message":{"id":"a-1","author":{"role":"assistant"},"content":{"content_type":"text","parts":["ok"]},"metadata":{"model_slug":"gpt-4o"}}}',
        'event: ping',
        ': comment line',
        'data: [DONE]',
      ].join('\n');

      const result = parseSSEStream(sse);
      expect(result.conversationId).toBe('conv-1');
      expect(result.text).toBe('ok');
    });

    it('takes last text value from progressive updates', () => {
      const sse = [
        'data: {"conversation_id":"c","message":{"id":"m","author":{"role":"assistant"},"content":{"content_type":"text","parts":["A"]},"metadata":{"model_slug":"gpt-4o"}}}',
        'data: {"conversation_id":"c","message":{"id":"m","author":{"role":"assistant"},"content":{"content_type":"text","parts":["AB"]},"metadata":{"model_slug":"gpt-4o"}}}',
        'data: {"conversation_id":"c","message":{"id":"m","author":{"role":"assistant"},"content":{"content_type":"text","parts":["ABC"]},"metadata":{"model_slug":"gpt-4o"}}}',
        'data: [DONE]',
      ].join('\n');

      const result = parseSSEStream(sse);
      expect(result.text).toBe('ABC');
    });
  });
});
