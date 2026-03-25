# webctl

Make any website your CLI. HTTP-first, browser fallback.

A collection of open-source website CLI adapters designed for AI agents. Each adapter turns a website's functionality into structured, scriptable CLI commands with JSON output.

## Architecture

```
User / AI Agent
      │
      ▼
   webctl CLI
      │
      ├─── HTTP Transport (default, fast, zero overhead)
      │         │
      │         ▼
      │    Saved Session ──→ Website API (RPC)
      │
      ├─── CDP Transport (connect to running local Chrome)
      │         │
      │         ▼
      │    page.evaluate(fetch(...)) ──→ Website API
      │
      └─── Launch Transport (start new browser, heavyweight)
                │
                ▼
           Playwright ──→ Website API
```

**Three-tier transport priority:**

1. **HTTP + saved session** — millisecond response, zero resource overhead
2. **CDP to local Chrome** — reuse your existing browser sessions, no new instance
3. **Launch new browser** — only for first-time login or when all sessions expire

## Supported Sites

| Site | Commands | Strategy |
|------|----------|----------|
| **Gemini** | `chat` | HTTP with session refresh |
| **NotebookLM** | `list`, `create`, `detail`, `delete`, `add-url`, `add-text`, `chat`, `audio`, `quota` | HTTP with session refresh |

## Quick Start

```bash
git clone https://github.com/icebear0828/webctl.git
cd webctl
pnpm install
pnpm build
```

### Usage

```bash
# Gemini
webctl gemini chat "What is the meaning of life?"
webctl gemini chat "Follow up question" --conversation c_abc123

# NotebookLM
webctl notebooklm list
webctl notebooklm create "Research Notes"
webctl notebooklm add-url <notebook-id> https://example.com/article
webctl notebooklm chat <notebook-id> "Summarize the key points"
webctl notebooklm audio <notebook-id> --output ./audio
webctl notebooklm quota
```

### Global Flags

```
-f, --format <fmt>    Output format: json (default) or text
--verbose             Debug logging to stderr
```

### Output Format

All output is structured JSON by default — designed for AI agent consumption:

```json
{
  "ok": true,
  "data": {
    "text": "Response from the website...",
    "conversationId": "c_abc123"
  }
}
```

Exit codes: `0` success, `1` error, `2` auth required, `3` network error, `5` rate limited.

## Session Management

Sessions are persisted at `~/.config/webctl/sessions/<site>/<userId>.json` with per-site TTL:

| Site | TTL | Refresh |
|------|-----|---------|
| Gemini | 2 hours | Auto-refresh via app page HTML |
| NotebookLM | 2 hours | Auto-refresh via dashboard HTML |

Sessions are automatically refreshed on 401/400 responses. If refresh fails, re-login via browser is required.

## Adding a New Site

Each site adapter lives in `src/sites/<site>/` and follows a standard structure:

```
src/sites/<site>/
├── types.ts       # Session + API response types
├── parser.ts      # Response parsing logic
├── client.ts      # HTTP client with session refresh
└── index.ts       # cli() command registration
```

Register commands using the `cli()` function:

```typescript
import { cli, Strategy } from '../../core/registry.js';

cli({
  site: 'mysite',
  name: 'search',
  description: 'Search for items',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search query' },
    { name: 'limit', type: 'int', default: 20, help: 'Result limit' },
  ],
  columns: ['title', 'url'],
  func: async (transport, session, kwargs) => {
    // Your implementation here
  },
});
```

## Development

```bash
pnpm test          # Run all tests
pnpm test:watch    # Watch mode
pnpm lint          # Type check
pnpm build         # Compile TypeScript
```

## License

MIT

---

# webctl

将任何网站变成 CLI。HTTP 优先，浏览器兜底。

一组开源的网站 CLI 适配器，专为 AI agent 设计。每个适配器将网站功能转化为结构化、可脚本化的 CLI 命令，输出 JSON 格式。

## 架构

```
用户 / AI Agent
      │
      ▼
   webctl CLI
      │
      ├─── HTTP Transport（默认，快速，零开销）
      │         │
      │         ▼
      │    已保存的 Session ──→ 网站 API (RPC)
      │
      ├─── CDP Transport（连接本地运行中的 Chrome）
      │         │
      │         ▼
      │    page.evaluate(fetch(...)) ──→ 网站 API
      │
      └─── Launch Transport（启动新浏览器，重量级）
                │
                ▼
           Playwright ──→ 网站 API
```

**三级 Transport 优先级：**

1. **HTTP + 已保存 session** — 毫秒级响应，零资源开销
2. **CDP 连接本地 Chrome** — 复用已有浏览器会话，无需启动新实例
3. **启动新浏览器** — 仅首次登录或 session 全部失效时使用

## 支持的网站

| 网站 | 命令 | 策略 |
|------|------|------|
| **Gemini** | `chat` | HTTP + session 自动刷新 |
| **NotebookLM** | `list`, `create`, `detail`, `delete`, `add-url`, `add-text`, `chat`, `audio`, `quota` | HTTP + session 自动刷新 |

## 快速开始

```bash
git clone https://github.com/icebear0828/webctl.git
cd webctl
pnpm install
pnpm build
```

### 使用示例

```bash
# Gemini
webctl gemini chat "生命的意义是什么？"
webctl gemini chat "追问" --conversation c_abc123

# NotebookLM
webctl notebooklm list
webctl notebooklm create "学习笔记"
webctl notebooklm add-url <notebook-id> https://example.com/article
webctl notebooklm chat <notebook-id> "总结要点"
webctl notebooklm audio <notebook-id> --output ./audio
webctl notebooklm quota
```

### 全局参数

```
-f, --format <fmt>    输出格式：json（默认）或 text
--verbose             调试日志输出到 stderr
```

### 输出格式

默认输出结构化 JSON，为 AI agent 消费而设计：

```json
{
  "ok": true,
  "data": {
    "text": "网站的响应内容...",
    "conversationId": "c_abc123"
  }
}
```

退出码：`0` 成功，`1` 错误，`2` 需要认证，`3` 网络错误，`5` 频率限制。

## Session 管理

Session 持久化在 `~/.config/webctl/sessions/<site>/<userId>.json`，每个站点有独立的 TTL：

| 网站 | TTL | 刷新方式 |
|------|-----|----------|
| Gemini | 2 小时 | 通过 app 页面 HTML 自动刷新 |
| NotebookLM | 2 小时 | 通过 dashboard HTML 自动刷新 |

收到 401/400 响应时自动刷新 session。刷新失败则需要通过浏览器重新登录。

## 添加新站点

每个站点适配器位于 `src/sites/<site>/`，遵循标准结构：

```
src/sites/<site>/
├── types.ts       # Session + API 响应类型
├── parser.ts      # 响应解析逻辑
├── client.ts      # HTTP 客户端 + session 刷新
└── index.ts       # cli() 命令注册
```

使用 `cli()` 函数注册命令：

```typescript
import { cli, Strategy } from '../../core/registry.js';

cli({
  site: 'mysite',
  name: 'search',
  description: '搜索内容',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'query', required: true, positional: true, help: '搜索关键词' },
    { name: 'limit', type: 'int', default: 20, help: '结果数量限制' },
  ],
  columns: ['title', 'url'],
  func: async (transport, session, kwargs) => {
    // 你的实现
  },
});
```

## 开发

```bash
pnpm test          # 运行所有测试
pnpm test:watch    # 监听模式
pnpm lint          # 类型检查
pnpm build         # 编译 TypeScript
```

## 许可证

MIT
