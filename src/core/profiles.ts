/**
 * Browser profile directory management.
 * Profiles: ~/.config/webctl/profiles/<site>/
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdir } from 'node:fs/promises';

function defaultProfileBase(): string {
  return join(
    process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'),
    'webctl',
    'profiles',
  );
}

export function getProfileDir(site: string): string {
  return join(defaultProfileBase(), site);
}

export async function ensureProfileDir(site: string): Promise<string> {
  const dir = getProfileDir(site);
  await mkdir(dir, { recursive: true });
  return dir;
}
