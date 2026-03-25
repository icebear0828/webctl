import { describe, it, expect } from 'vitest';
import {
  parseCreateNotebook, parseListNotebooks, parseNotebookDetail,
  parseAddSource, parseGenerateArtifact, parseChatStream, parseQuota,
} from '../../src/sites/notebooklm/parser.js';

/** Helper: wrap inner JSON as a Boq wrb.fr envelope */
function boq(inner: unknown): string {
  const innerStr = JSON.stringify(inner);
  const chunk = JSON.stringify([['wrb.fr', null, innerStr]]);
  return `${chunk.length}\n${chunk}`;
}

describe('NotebookLM Parser', () => {
  it('parseCreateNotebook extracts UUID', () => {
    const raw = boq(['', null, 'abc123-def456-ghi789']);
    const result = parseCreateNotebook(raw);
    expect(result.notebookId).toBe('abc123-def456-ghi789');
  });

  it('parseListNotebooks extracts entries', () => {
    const raw = boq([[
      ['My Notebook', [['src1'], ['src2']], '12345678-abcd-efgh-1234-567890abcdef'],
      ['Other', [], 'deadbeef-1234-5678-9abc-def012345678'],
    ]]);
    const result = parseListNotebooks(raw);
    expect(result).toHaveLength(2);
    expect(result[0]?.title).toBe('My Notebook');
    expect(result[0]?.sourceCount).toBe(2);
    expect(result[1]?.id).toBe('deadbeef-1234-5678-9abc-def012345678');
  });

  it('parseNotebookDetail extracts title and sources', () => {
    const raw = boq([['Test Notebook', [
      [['src-uuid-1'], 'Source 1', [null, 500]],
      [['src-uuid-2'], 'Source 2', [null, 1200]],
    ], 'notebook-uuid']]);
    const result = parseNotebookDetail(raw);
    expect(result.title).toBe('Test Notebook');
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]?.wordCount).toBe(500);
  });

  it('parseAddSource extracts source info', () => {
    const raw = boq([[[['src-uuid-new'], 'My Source']]]);
    const result = parseAddSource(raw);
    expect(result.sourceId).toBe('src-uuid-new');
    expect(result.title).toBe('My Source');
  });

  it('parseGenerateArtifact extracts artifact info', () => {
    const raw = boq([['artifact-uuid', 'Deep Dive', 1]]);
    const result = parseGenerateArtifact(raw);
    expect(result.artifactId).toBe('artifact-uuid');
    expect(result.title).toBe('Deep Dive');
  });

  it('parseChatStream extracts last text', () => {
    // Two chunks: partial then final
    const chunk1 = JSON.stringify([['wrb.fr', null, JSON.stringify([['Thinking...', null, ['thread-1', 'resp-1', 1]]])]]);
    const chunk2 = JSON.stringify([['wrb.fr', null, JSON.stringify([['Final answer here.', null, ['thread-1', 'resp-2', 2]]])]]);
    const raw = `${chunk1.length}\n${chunk1}\n${chunk2.length}\n${chunk2}`;
    const result = parseChatStream(raw);
    expect(result.text).toBe('Final answer here.');
    expect(result.threadId).toBe('thread-1');
  });

  it('parseQuota extracts limits', () => {
    const raw = boq([[null, [5, 10, 100, 500000]]]);
    const result = parseQuota(raw);
    expect(result.audioRemaining).toBe(5);
    expect(result.audioLimit).toBe(10);
    expect(result.notebookLimit).toBe(100);
    expect(result.sourceWordLimit).toBe(500000);
  });
});
