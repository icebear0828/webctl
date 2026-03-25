/**
 * NotebookLM HTTP client — undici + Chrome TLS fingerprint.
 */

import { request, type Agent } from 'undici';
import type { NotebookSession, NotebookInfo, SourceInfo, ArtifactInfo, StudioConfig, QuotaInfo, ResearchResult } from './types.js';
import type { SessionStore } from '../../core/session.js';
import { createChromeTlsAgent } from '../../core/tls.js';
import { mergeCookies } from '../../core/cookies.js';
import { NB_RPC, NB_URLS, DEFAULT_USER_CONFIG, PLATFORM_WEB } from './rpc-ids.js';
import {
  parseCreateNotebook, parseListNotebooks, parseNotebookDetail,
  parseAddSource, parseSourceSummary,
  parseGenerateArtifact, parseArtifacts,
  parseChatStream, parseStudioConfig, parseQuota, parseResearchResults,
  parseEnvelopes,
} from './parser.js';

function parseSecChUa(userAgent: string): { secChUa: string; secChUaMobile: string; secChUaPlatform: string } {
  const chromeMatch = userAgent.match(/Chrome\/(\d+)/);
  const version = chromeMatch?.[1] ?? '131';
  let platform = '"macOS"';
  if (userAgent.includes('Windows')) platform = '"Windows"';
  else if (userAgent.includes('Linux') && !userAgent.includes('Android')) platform = '"Linux"';
  return {
    secChUa: `"Chromium";v="${version}", "Google Chrome";v="${version}", "Not-A.Brand";v="99"`,
    secChUaMobile: '?0',
    secChUaPlatform: platform,
  };
}

export class NotebookClient {
  private session: NotebookSession | null = null;
  private store: SessionStore<NotebookSession>;
  private agent: Agent;
  private reqCounter = 100000;
  private chatThreadId = '';
  private chatHistory: Array<[string, null, number]> = [];

  constructor(store: SessionStore<NotebookSession>) {
    this.store = store;
    this.agent = createChromeTlsAgent();
  }

  async loadSession(userId?: string): Promise<boolean> {
    this.session = await this.store.load(userId);
    return this.session !== null;
  }

  async dispose(): Promise<void> {
    await this.agent.close();
  }

  // ── Low-level RPC ──

  private async execute(rpcId: string, payload: unknown[], sourcePath = '/'): Promise<string> {
    const session = this.session!;
    const reqId = this.nextReqId();

    const fReq = JSON.stringify([[[rpcId, JSON.stringify(payload), null, 'generic']]]);
    const body = new URLSearchParams({ 'f.req': fReq, at: session.at }).toString();

    const qp = new URLSearchParams({
      rpcids: rpcId, 'source-path': sourcePath,
      bl: session.bl, hl: 'en', _reqid: String(reqId), rt: 'c',
      ...(session.fsid ? { 'f.sid': session.fsid } : {}),
    });

    const { statusCode, body: resBody } = await request(
      `${NB_URLS.BATCH_EXECUTE}?${qp.toString()}`,
      { method: 'POST', headers: this.buildHeaders(), body, dispatcher: this.agent },
    );

    const text = await resBody.text();

    if (statusCode === 401 || statusCode === 400) {
      await this.refreshSession();
      return this.execute(rpcId, payload, sourcePath);
    }

    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`NotebookLM HTTP ${statusCode}: ${text.slice(0, 200)}`);
    }
    return text;
  }

  private async executeChat(notebookId: string, message: string, sourceIds: string[]): Promise<string> {
    const session = this.session!;
    const reqId = this.nextReqId();
    const sourceIdArrays = sourceIds.map(id => [[id]]);

    const innerPayload = [
      sourceIdArrays, message,
      this.chatHistory.length > 0 ? this.chatHistory : [],
      [2, null, [1], [1]],
      this.chatThreadId || null, null, null,
      notebookId, 1,
    ];

    const fReq = JSON.stringify([null, JSON.stringify(innerPayload)]);
    const body = new URLSearchParams({ 'f.req': fReq, at: session.at }).toString();

    const qp = new URLSearchParams({
      bl: session.bl, hl: 'en', _reqid: String(reqId), rt: 'c',
      ...(session.fsid ? { 'f.sid': session.fsid } : {}),
    });

    const { statusCode, body: resBody } = await request(
      `${NB_URLS.CHAT_STREAM}?${qp.toString()}`,
      { method: 'POST', headers: this.buildHeaders(), body, dispatcher: this.agent },
    );

    const text = await resBody.text();
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`NotebookLM chat HTTP ${statusCode}: ${text.slice(0, 200)}`);
    }
    return text;
  }

  // ── Notebook CRUD ──

  async createNotebook(title = ''): Promise<{ notebookId: string }> {
    const raw = await this.execute(NB_RPC.CREATE_NOTEBOOK, [title, null, null, [...PLATFORM_WEB], [1]], '/');
    return parseCreateNotebook(raw);
  }

  async listNotebooks(): Promise<NotebookInfo[]> {
    const raw = await this.execute(NB_RPC.LIST_NOTEBOOKS, [null, 1, null, [...PLATFORM_WEB]], '/');
    return parseListNotebooks(raw);
  }

  async getNotebookDetail(notebookId: string): Promise<{ title: string; sources: SourceInfo[] }> {
    const raw = await this.execute(NB_RPC.GET_NOTEBOOK, [notebookId, null, [...PLATFORM_WEB], null, 1], `/notebook/${notebookId}`);
    return parseNotebookDetail(raw);
  }

  async deleteNotebook(notebookId: string): Promise<void> {
    await this.execute(NB_RPC.DELETE_NOTEBOOK, [[notebookId], [...PLATFORM_WEB]], '/');
  }

  // ── Source Management ──

  async addUrlSource(notebookId: string, url: string): Promise<{ sourceId: string; title: string }> {
    const raw = await this.execute(NB_RPC.ADD_SOURCE, [
      [[null, null, [url], null, null, null, null, null, null, null, 1]],
      notebookId, [...PLATFORM_WEB],
      [1, null, null, null, null, null, null, null, null, null, [1]],
    ], `/notebook/${notebookId}`);
    return parseAddSource(raw);
  }

  async addTextSource(notebookId: string, title: string, content: string): Promise<{ sourceId: string; title: string }> {
    const raw = await this.execute(NB_RPC.ADD_SOURCE, [
      [[null, [title, content], null, 2, null, null, null, null, null, null, 1]],
      notebookId, [...PLATFORM_WEB],
      [1, null, null, null, null, null, null, null, null, null, [1]],
    ], `/notebook/${notebookId}`);
    return parseAddSource(raw);
  }

  async getSourceSummary(sourceId: string): Promise<{ summary: string }> {
    const raw = await this.execute(NB_RPC.GET_SOURCE_SUMMARY, [[[[sourceId]]]]);
    return { summary: parseSourceSummary(raw).summary };
  }

  async deleteSource(sourceId: string): Promise<void> {
    await this.execute(NB_RPC.DELETE_SOURCE, [[[sourceId]], [...PLATFORM_WEB]]);
  }

  // ── Research ──

  async createWebSearch(notebookId: string, query: string, mode: 'fast' | 'deep' = 'fast'): Promise<{ researchId: string }> {
    const modeFlag = mode === 'deep' ? 2 : 1;
    const raw = await this.execute(NB_RPC.CREATE_WEB_SEARCH, [[query, modeFlag], null, 1, notebookId], `/notebook/${notebookId}`);
    const envelopes = parseEnvelopes(raw);
    for (const env of envelopes) {
      if (Array.isArray(env) && typeof env[0] === 'string') return { researchId: env[0] };
    }
    return { researchId: '' };
  }

  async pollResearchResults(notebookId: string, timeoutMs = 120_000): Promise<ResearchResult[]> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const raw = await this.execute(NB_RPC.GET_ALL_ARTIFACTS, [null, null, notebookId], `/notebook/${notebookId}`);
      const { status, results } = parseResearchResults(raw);
      if (status >= 2) return results;
      await new Promise(r => setTimeout(r, 5000));
    }
    return [];
  }

  async importResearch(notebookId: string, researchId: string, results: ResearchResult[]): Promise<void> {
    const sources = results.map(r => [null, null, [r.url, r.title], null, null, null, null, null, null, null, 2]);
    await this.execute(NB_RPC.IMPORT_RESEARCH, [null, [1], researchId, notebookId, sources], `/notebook/${notebookId}`);
  }

  // ── Artifacts ──

  async generateArtifact(notebookId: string, type: number, sourceIds: string[], options?: {
    language?: string; customPrompt?: string;
  }): Promise<{ artifactId: string; title: string }> {
    const sourceIdArraysTriple = sourceIds.map(id => [[id]]);
    const sourceIdArraysSingle = sourceIds.map(id => [id]);
    const language = options?.language ?? 'en';

    const raw = await this.execute(NB_RPC.GENERATE_ARTIFACT, [
      [...DEFAULT_USER_CONFIG], notebookId,
      [options?.customPrompt ?? null, null, type, sourceIdArraysTriple, null, null,
        [null, [null, 2, null, sourceIdArraysSingle, language, null, 1]]],
    ], `/notebook/${notebookId}`);
    return parseGenerateArtifact(raw);
  }

  async getArtifacts(notebookId: string): Promise<ArtifactInfo[]> {
    const raw = await this.execute(NB_RPC.GET_ARTIFACTS_FILTERED, [
      [...DEFAULT_USER_CONFIG], notebookId,
      'NOT artifact.status = "ARTIFACT_STATUS_SUGGESTED"',
    ], `/notebook/${notebookId}`);
    return parseArtifacts(raw);
  }

  async deleteArtifact(artifactId: string): Promise<void> {
    await this.execute(NB_RPC.DELETE_ARTIFACT, [[...DEFAULT_USER_CONFIG], artifactId]);
  }

  async downloadAudio(downloadUrl: string, outputDir: string): Promise<string> {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const session = this.session!;

    mkdirSync(outputDir, { recursive: true });

    const { statusCode, headers: resHeaders, body: resBody } = await request(downloadUrl, {
      method: 'GET',
      headers: {
        'User-Agent': session.userAgent,
        'Cookie': session.cookies,
        'Accept': '*/*',
        'Referer': `${NB_URLS.BASE}/`,
      },
      dispatcher: this.agent,
    });

    if (statusCode !== 200) {
      const text = await resBody.text();
      throw new Error(`Audio download failed: HTTP ${statusCode} — ${text.slice(0, 200)}`);
    }

    const disposition = resHeaders['content-disposition'];
    const dispStr = Array.isArray(disposition) ? disposition[0] : disposition;
    let filename = `audio_${Date.now()}.m4a`;
    if (typeof dispStr === 'string') {
      const match = dispStr.match(/filename="?([^";\n]+)"?/);
      if (match?.[1]) filename = match[1];
    }

    const filePath = join(outputDir, filename);
    const buffer = Buffer.from(await resBody.arrayBuffer());
    writeFileSync(filePath, buffer);
    return filePath;
  }

  // ── Config ──

  async getStudioConfig(notebookId: string): Promise<StudioConfig> {
    const raw = await this.execute(NB_RPC.GET_STUDIO_CONFIG, [[...DEFAULT_USER_CONFIG], notebookId], `/notebook/${notebookId}`);
    return parseStudioConfig(raw);
  }

  async getQuota(): Promise<QuotaInfo> {
    const raw = await this.execute(NB_RPC.GET_QUOTA, [[...PLATFORM_WEB]], '/');
    return parseQuota(raw);
  }

  // ── Chat ──

  async sendChat(notebookId: string, message: string, sourceIds: string[]): Promise<{ text: string; threadId: string }> {
    const raw = await this.executeChat(notebookId, message, sourceIds);
    const result = parseChatStream(raw);
    if (result.threadId) this.chatThreadId = result.threadId;
    this.chatHistory.push([message, null, 1]);
    if (result.text) this.chatHistory.push([result.text, null, 2]);
    return { text: result.text, threadId: result.threadId };
  }

  // ── Session Refresh ──

  private async refreshSession(): Promise<void> {
    const session = this.session!;

    const { statusCode, headers: resHeaders, body: resBody } = await request(NB_URLS.DASHBOARD, {
      method: 'GET',
      headers: {
        'User-Agent': session.userAgent,
        'Cookie': session.cookies,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      dispatcher: this.agent,
    });

    const html = await resBody.text();

    if (statusCode !== 200 || html.includes('accounts.google.com/ServiceLogin')) {
      throw new Error('Session expired — cookies invalid. Run `webctl notebooklm login`.');
    }

    const atMatch = html.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
    const blMatch = html.match(/"cfb2h"\s*:\s*"([^"]+)"/);
    const fsidMatch = html.match(/"FdrFJe"\s*:\s*"([^"]+)"/);
    const atValue = atMatch?.[1];
    const blValue = blMatch?.[1];

    if (!atValue || !blValue) throw new Error('Failed to extract tokens from dashboard HTML');
    if (!blValue.includes('labs-tailwind')) throw new Error(`Unexpected bl: ${blValue.slice(0, 50)}`);

    const setCookies = resHeaders['set-cookie'];
    const setCookieArr = Array.isArray(setCookies) ? setCookies : setCookies ? [setCookies] : [];
    const newCookies = setCookieArr.length > 0 ? mergeCookies(session.cookies, setCookieArr) : session.cookies;

    this.session = { at: atValue, bl: blValue, fsid: fsidMatch?.[1] ?? '', cookies: newCookies, userAgent: session.userAgent };
    await this.store.save(this.session);
  }

  private buildHeaders(): Record<string, string> {
    const session = this.session!;
    const { secChUa, secChUaMobile, secChUaPlatform } = parseSecChUa(session.userAgent);
    return {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent': session.userAgent,
      'Cookie': session.cookies,
      'Origin': NB_URLS.BASE,
      'Referer': `${NB_URLS.BASE}/`,
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'Sec-CH-UA': secChUa,
      'Sec-CH-UA-Mobile': secChUaMobile,
      'Sec-CH-UA-Platform': secChUaPlatform,
      'X-Same-Domain': '1',
    };
  }

  private nextReqId(): number {
    this.reqCounter += Math.floor(100000 + Math.random() * 100000);
    return this.reqCounter;
  }
}
