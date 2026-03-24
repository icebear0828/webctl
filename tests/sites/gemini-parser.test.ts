import { describe, it, expect } from 'vitest';
import { stripSafetyPrefix, extractJsonChunks, parseStreamGenerateResponse } from '../../src/sites/gemini/parser.js';

describe('Gemini Parser', () => {
  describe('stripSafetyPrefix', () => {
    it('strips )]}\\\'\\n prefix', () => {
      expect(stripSafetyPrefix(")]}'\n{\"a\":1}")).toBe('{"a":1}');
    });

    it('handles no prefix', () => {
      expect(stripSafetyPrefix('{"a":1}')).toBe('{"a":1}');
    });
  });

  describe('extractJsonChunks', () => {
    it('parses length-prefixed chunks', () => {
      const body = '13\n[["a","b","c"]]';
      const chunks = extractJsonChunks(body);
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toEqual([['a', 'b', 'c']]);
    });

    it('handles multiple chunks', () => {
      const body = '5\n[1,2]\n5\n[3,4]';
      const chunks = extractJsonChunks(body);
      expect(chunks.length).toBe(2);
    });
  });

  describe('parseStreamGenerateResponse', () => {
    it('returns empty for empty input', () => {
      const result = parseStreamGenerateResponse('');
      expect(result.text).toBe('');
    });

    it('parses wrb.fr envelope with text', () => {
      const inner = JSON.stringify([
        null,
        ['c_abc', 'r_def'],
        null,
        null,
        [['rc_ghi', ['Hello, world!']]],
      ]);
      const chunk = JSON.stringify([['wrb.fr', null, inner]]);
      const raw = `${chunk.length}\n${chunk}`;

      const result = parseStreamGenerateResponse(raw);
      expect(result.text).toBe('Hello, world!');
      expect(result.conversationId).toBe('c_abc');
      expect(result.responseId).toBe('r_def');
      expect(result.choiceId).toBe('rc_ghi');
    });
  });
});
