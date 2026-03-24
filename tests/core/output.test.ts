import { describe, it, expect } from 'vitest';
import { formatOutput, success, error } from '../../src/core/output.js';

describe('Output', () => {
  it('formats success as JSON', () => {
    const output = formatOutput(success({ text: 'hello' }), 'json');
    const parsed = JSON.parse(output) as { ok: boolean; data: { text: string } };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.text).toBe('hello');
  });

  it('formats error as JSON', () => {
    const output = formatOutput(error('AUTH', 'Login required'), 'json');
    const parsed = JSON.parse(output) as { ok: boolean; error: { code: string; message: string } };
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('AUTH');
  });

  it('formats error as text', () => {
    const output = formatOutput(error('AUTH', 'Login required'), 'text');
    expect(output).toContain('AUTH');
    expect(output).toContain('Login required');
  });

  it('formats array data as text', () => {
    const output = formatOutput(success([{ a: 1, b: 2 }]), 'text');
    expect(output).toContain('a: 1');
  });
});
