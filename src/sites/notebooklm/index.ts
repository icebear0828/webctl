/**
 * NotebookLM site adapter — registers CLI commands.
 */

import { cli, Strategy, type CommandArgs } from '../../core/registry.js';
import { createSessionStore } from '../../core/session.js';
import { NotebookClient } from './client.js';
import type { NotebookSession } from './types.js';

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours (Google tokens)

function getClient(): NotebookClient {
  return new NotebookClient(createSessionStore<NotebookSession>({ site: 'notebooklm', ttlMs: SESSION_TTL_MS }));
}

async function withClient<T>(userId: string | undefined, fn: (client: NotebookClient) => Promise<T>): Promise<T> {
  const client = getClient();
  const loaded = await client.loadSession(userId);
  if (!loaded) throw new Error('No session found. Run `webctl notebooklm auth login` first.');
  return fn(client);
}

// ── Notebook commands ──

cli({
  site: 'notebooklm', name: 'list', description: 'List notebooks',
  domain: 'notebooklm.google.com', strategy: Strategy.COOKIE,
  args: [{ name: 'user', help: 'Session user ID' }],
  columns: ['id', 'title', 'sourceCount'],
  func: async (_t, _s, kwargs: CommandArgs) =>
    withClient(kwargs['user'] as string | undefined, c => c.listNotebooks()),
});

cli({
  site: 'notebooklm', name: 'create', description: 'Create a new notebook',
  domain: 'notebooklm.google.com', strategy: Strategy.COOKIE,
  args: [
    { name: 'title', positional: true, help: 'Notebook title' },
    { name: 'user', help: 'Session user ID' },
  ],
  func: async (_t, _s, kwargs: CommandArgs) =>
    withClient(kwargs['user'] as string | undefined, c => c.createNotebook(kwargs['title'] as string ?? '')),
});

cli({
  site: 'notebooklm', name: 'detail', description: 'Get notebook detail with sources',
  domain: 'notebooklm.google.com', strategy: Strategy.COOKIE,
  args: [
    { name: 'notebook', required: true, positional: true, help: 'Notebook ID' },
    { name: 'user', help: 'Session user ID' },
  ],
  func: async (_t, _s, kwargs: CommandArgs) =>
    withClient(kwargs['user'] as string | undefined, c => c.getNotebookDetail(kwargs['notebook'] as string)),
});

cli({
  site: 'notebooklm', name: 'delete', description: 'Delete a notebook',
  domain: 'notebooklm.google.com', strategy: Strategy.COOKIE,
  args: [
    { name: 'notebook', required: true, positional: true, help: 'Notebook ID' },
    { name: 'user', help: 'Session user ID' },
  ],
  func: async (_t, _s, kwargs: CommandArgs) =>
    withClient(kwargs['user'] as string | undefined, c => c.deleteNotebook(kwargs['notebook'] as string)),
});

// ── Source commands ──

cli({
  site: 'notebooklm', name: 'add-url', description: 'Add URL source to notebook',
  domain: 'notebooklm.google.com', strategy: Strategy.COOKIE,
  args: [
    { name: 'notebook', required: true, positional: true, help: 'Notebook ID' },
    { name: 'url', required: true, positional: true, help: 'Source URL' },
    { name: 'user', help: 'Session user ID' },
  ],
  func: async (_t, _s, kwargs: CommandArgs) =>
    withClient(kwargs['user'] as string | undefined, c => c.addUrlSource(kwargs['notebook'] as string, kwargs['url'] as string)),
});

cli({
  site: 'notebooklm', name: 'add-text', description: 'Add text source to notebook',
  domain: 'notebooklm.google.com', strategy: Strategy.COOKIE,
  args: [
    { name: 'notebook', required: true, positional: true, help: 'Notebook ID' },
    { name: 'title', required: true, help: 'Source title' },
    { name: 'content', required: true, help: 'Text content' },
    { name: 'user', help: 'Session user ID' },
  ],
  func: async (_t, _s, kwargs: CommandArgs) =>
    withClient(kwargs['user'] as string | undefined, c => c.addTextSource(kwargs['notebook'] as string, kwargs['title'] as string, kwargs['content'] as string)),
});

// ── Chat ──

cli({
  site: 'notebooklm', name: 'chat', description: 'Chat with notebook sources',
  domain: 'notebooklm.google.com', strategy: Strategy.COOKIE,
  args: [
    { name: 'notebook', required: true, positional: true, help: 'Notebook ID' },
    { name: 'message', required: true, positional: true, help: 'Message to send' },
    { name: 'user', help: 'Session user ID' },
  ],
  columns: ['text', 'threadId'],
  func: async (_t, _s, kwargs: CommandArgs) => {
    return withClient(kwargs['user'] as string | undefined, async c => {
      const detail = await c.getNotebookDetail(kwargs['notebook'] as string);
      const sourceIds = detail.sources.map(s => s.id);
      return c.sendChat(kwargs['notebook'] as string, kwargs['message'] as string, sourceIds);
    });
  },
});

// ── Audio ──

cli({
  site: 'notebooklm', name: 'audio', description: 'Generate audio overview for notebook',
  domain: 'notebooklm.google.com', strategy: Strategy.COOKIE,
  args: [
    { name: 'notebook', required: true, positional: true, help: 'Notebook ID' },
    { name: 'output', required: true, help: 'Output directory' },
    { name: 'language', help: 'Audio language (en, zh, ja...)', default: 'en' },
    { name: 'prompt', help: 'Custom prompt for audio generation' },
    { name: 'user', help: 'Session user ID' },
  ],
  func: async (_t, _s, kwargs: CommandArgs) => {
    return withClient(kwargs['user'] as string | undefined, async c => {
      const detail = await c.getNotebookDetail(kwargs['notebook'] as string);
      const sourceIds = detail.sources.map(s => s.id);
      const { artifactId } = await c.generateArtifact(
        kwargs['notebook'] as string, 1, sourceIds,
        { language: kwargs['language'] as string, customPrompt: kwargs['prompt'] as string | undefined },
      );

      // Poll for audio ready
      const start = Date.now();
      while (Date.now() - start < 1_800_000) {
        const artifacts = await c.getArtifacts(kwargs['notebook'] as string);
        const artifact = artifacts.find(a => a.id === artifactId);
        if (artifact?.downloadUrl) {
          const path = await c.downloadAudio(artifact.downloadUrl, kwargs['output'] as string);
          return { audioPath: path, artifactId };
        }
        await new Promise(r => setTimeout(r, 10000));
      }
      throw new Error('Audio generation timed out');
    });
  },
});

// ── Quota ──

cli({
  site: 'notebooklm', name: 'quota', description: 'Check usage quota',
  domain: 'notebooklm.google.com', strategy: Strategy.COOKIE,
  args: [{ name: 'user', help: 'Session user ID' }],
  columns: ['audioRemaining', 'audioLimit', 'notebookLimit'],
  func: async (_t, _s, kwargs: CommandArgs) =>
    withClient(kwargs['user'] as string | undefined, c => c.getQuota()),
});

export { NotebookClient } from './client.js';
export type { NotebookSession, NotebookInfo, SourceInfo, ArtifactInfo } from './types.js';
