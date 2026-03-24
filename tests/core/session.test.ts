import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSessionStore } from '../../src/core/session.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('SessionStore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'webctl-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saves and loads session data', async () => {
    const store = createSessionStore<{ token: string }>({
      site: 'test',
      ttlMs: 60_000,
      baseDir: tmpDir,
    });

    await store.save({ token: 'abc123' });
    const loaded = await store.load();
    expect(loaded).toEqual({ token: 'abc123' });
  });

  it('returns null for missing session', async () => {
    const store = createSessionStore<{ token: string }>({
      site: 'test',
      ttlMs: 60_000,
      baseDir: tmpDir,
    });
    expect(await store.load()).toBeNull();
  });

  it('supports multiple user IDs', async () => {
    const store = createSessionStore<{ token: string }>({
      site: 'test',
      ttlMs: 60_000,
      baseDir: tmpDir,
    });

    await store.save({ token: 'user1' }, 'alice');
    await store.save({ token: 'user2' }, 'bob');

    expect(await store.load('alice')).toEqual({ token: 'user1' });
    expect(await store.load('bob')).toEqual({ token: 'user2' });
  });

  it('clears session', async () => {
    const store = createSessionStore<{ token: string }>({
      site: 'test',
      ttlMs: 60_000,
      baseDir: tmpDir,
    });

    await store.save({ token: 'abc' });
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('isFresh returns true within TTL', async () => {
    const store = createSessionStore<{ token: string }>({
      site: 'test',
      ttlMs: 60_000,
      baseDir: tmpDir,
    });

    await store.save({ token: 'abc' });
    expect(await store.isFresh()).toBe(true);
  });

  it('isFresh returns false when expired', async () => {
    const store = createSessionStore<{ token: string }>({
      site: 'test',
      ttlMs: 1, // 1ms TTL
      baseDir: tmpDir,
    });

    await store.save({ token: 'abc' });
    await new Promise(r => setTimeout(r, 10));
    expect(await store.isFresh()).toBe(false);
  });
});
