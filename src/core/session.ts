/**
 * Session persistence with per-site TTL.
 * Storage: ~/.config/webctl/sessions/<site>/<userId>.json
 */

import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

interface PersistedEnvelope<T> {
  data: T;
  savedAt: number;
  version: number;
}

export interface SessionStoreOptions {
  site: string;
  ttlMs: number;
  baseDir?: string;
}

export interface SessionStore<T> {
  load(userId?: string): Promise<T | null>;
  save(data: T, userId?: string): Promise<void>;
  clear(userId?: string): Promise<void>;
  isFresh(userId?: string): Promise<boolean>;
  path(userId?: string): string;
}

function defaultBaseDir(): string {
  return join(
    process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'),
    'webctl',
    'sessions',
  );
}

export function createSessionStore<T>(opts: SessionStoreOptions): SessionStore<T> {
  const baseDir = opts.baseDir ?? defaultBaseDir();
  const siteDir = join(baseDir, opts.site);

  function filePath(userId?: string): string {
    return join(siteDir, `${userId ?? 'default'}.json`);
  }

  return {
    path: filePath,

    async load(userId) {
      try {
        const raw = await readFile(filePath(userId), 'utf-8');
        const envelope = JSON.parse(raw) as PersistedEnvelope<T>;
        return envelope.data;
      } catch {
        return null;
      }
    },

    async save(data, userId) {
      await mkdir(siteDir, { recursive: true });
      const envelope: PersistedEnvelope<T> = {
        data,
        savedAt: Date.now(),
        version: 1,
      };
      await writeFile(filePath(userId), JSON.stringify(envelope, null, 2), {
        mode: 0o600,
      });
    },

    async clear(userId) {
      try {
        await unlink(filePath(userId));
      } catch {
        // ignore
      }
    },

    async isFresh(userId) {
      try {
        const raw = await readFile(filePath(userId), 'utf-8');
        const envelope = JSON.parse(raw) as PersistedEnvelope<T>;
        return Date.now() - envelope.savedAt < opts.ttlMs;
      } catch {
        return false;
      }
    },
  };
}
