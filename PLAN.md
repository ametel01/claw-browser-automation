# Claw Browser Automation — Implementation Plan

> A reliable, general-purpose browser automation layer for OpenClaw, replacing the flaky extension relay with managed Playwright sessions that the AI agent can drive directly.

## Problem

OpenClaw's current browser extension relay is unreliable. It breaks due to:
- Tab focus changes losing context
- Stale element references after DOM mutations
- CDP attachment races on connect/reconnect
- Browser profile and session drift
- Anti-bot script timing differences

This project replaces the extension relay as the **primary browser channel** for clawbot. Any task that requires browser interaction — booking, form filling, research, data extraction, account management — goes through this layer.

## Design Principles

1. **The agent drives, the engine executes.** Clawbot decides *what* to do. This layer provides reliable *how* — atomic actions with postcondition verification, not brittle scripts.
2. **Every action is observable.** Pre/post state, screenshots, timing, retries — all captured. When something fails, you know exactly where and why.
3. **Sessions survive failures.** Browser crashes, network drops, process restarts — the session state is checkpointed and restorable.
4. **Human-in-the-loop when needed.** The agent can pause any sequence and ask for approval via OpenClaw's channels before proceeding with irreversible actions.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  OpenClaw Agent (clawbot)                       │
│  - Receives user intent via any channel         │
│  - Decides what browser actions to take         │
│  - Calls browser tools exposed by this skill    │
└──────────────┬──────────────────────────────────┘
               │ tool calls
┌──────────────▼──────────────────────────────────┐
│  claw-browser-automation (OpenClaw skill)       │
│                                                 │
│  ┌─────────────┐  ┌──────────────┐              │
│  │ Tool Layer   │  │ Session Mgr  │              │
│  │ (agent API)  │──│ (lifecycle)  │              │
│  └──────┬──────┘  └──────┬───────┘              │
│         │                │                       │
│  ┌──────▼────────────────▼───────┐              │
│  │  Action Engine                │              │
│  │  precondition → act → verify  │              │
│  │  retries, re-resolve, jitter  │              │
│  └──────────────┬────────────────┘              │
│                 │                                │
│  ┌──────────────▼────────────────┐              │
│  │  Browser Pool                 │              │
│  │  Playwright contexts          │              │
│  │  health probes, auto-restart  │              │
│  └──────────────┬────────────────┘              │
│                 │                                │
│  ┌──────────────▼────────────────┐              │
│  │  State & Artifacts            │              │
│  │  SQLite checkpoints           │              │
│  │  screenshots, DOM snapshots   │              │
│  │  structured logs              │              │
│  └───────────────────────────────┘              │
└─────────────────────────────────────────────────┘
               │
    ┌──────────▼──────────┐
    │  Chromium (managed)  │
    └─────────────────────┘
```

The key insight: **clawbot already has the AI reasoning**. This layer doesn't need its own workflow engine or FSM. It just needs to make browser actions reliable and observable so the agent can compose them into any workflow — booking, shopping, research, form filling, whatever.

---

## Project Structure

```
claw-browser-automation/
├── package.json
├── tsconfig.json
├── biome.json                   # Linter + formatter — strict from day one
├── src/
│   ├── index.ts                 # OpenClaw skill entry — registers tools
│   ├── pool/
│   │   ├── browser-pool.ts      # Managed Chromium instances
│   │   └── health.ts            # Liveness probes, auto-restart
│   ├── session/
│   │   ├── session.ts           # BrowserSession — context + page + state
│   │   ├── snapshot.ts          # Serializable session state for checkpoint/restore
│   │   └── profiles.ts          # Persistent browser profiles (cookies, storage)
│   ├── actions/
│   │   ├── action.ts            # Base action: precondition → execute → verify
│   │   ├── navigate.ts          # Go to URL, wait for ready state
│   │   ├── interact.ts          # Click, type, select, hover, drag
│   │   ├── extract.ts           # Read text, attributes, tables, structured data
│   │   ├── wait.ts              # Wait for selector, condition, network idle
│   │   ├── page.ts              # Screenshot, PDF, evaluate JS, scroll
│   │   └── resilience.ts        # Retry logic, jitter, stale re-resolve, popup dismiss
│   ├── selectors/
│   │   └── strategy.ts          # Layered selector resolution (ARIA → text → CSS → DOM)
│   ├── store/
│   │   ├── db.ts                # SQLite setup + migrations
│   │   ├── sessions.ts          # Session checkpoint persistence
│   │   └── artifacts.ts         # Screenshot/snapshot file management
│   ├── observe/
│   │   ├── logger.ts            # Structured pino logger with correlation IDs
│   │   └── trace.ts             # Action-level timing and outcome tracking
│   └── tools/
│       ├── session-tools.ts     # open, close, list, restore session tools
│       ├── action-tools.ts      # navigate, click, type, extract, screenshot tools
│       ├── page-tools.ts        # evaluate JS, get page state, scroll tools
│       └── approval-tools.ts    # human confirmation gate tool
├── tests/
│   ├── pool/
│   ├── session/
│   ├── actions/
│   └── integration/
├── SPEC.md
└── PLAN.md
```

---

## Phase 0 — Project Bootstrap **COMPLETE**

### 0.1 Init & Dependencies

```bash
bun init
bun add playwright-core better-sqlite3 pino nanoid
bun add -D typescript @types/node @types/better-sqlite3 @biomejs/biome vitest
```

### 0.2 Biome — Strict Linting & Formatting

Set up Biome with strict rules from the start. No tech debt accumulation.

```bash
bun biome init
```

`biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "tab",
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "complexity": {
        "noExcessiveCognitiveComplexity": "error",
        "noVoid": "error",
        "useLiteralKeys": "error",
        "useSimplifiedLogicExpression": "error"
      },
      "correctness": {
        "noUndeclaredVariables": "error",
        "noUnusedImports": "error",
        "noUnusedVariables": "error",
        "noUnusedFunctionParameters": "error",
        "useExhaustiveDependencies": "warn"
      },
      "performance": {
        "noAccumulatingSpread": "error",
        "noBarrelFile": "error",
        "noReExportAll": "error"
      },
      "style": {
        "noNonNullAssertion": "error",
        "useConst": "error",
        "useExportType": "error",
        "useImportType": "error",
        "useNodejsImportProtocol": "error",
        "useNumberNamespace": "error",
        "useTemplate": "error"
      },
      "suspicious": {
        "noExplicitAny": "error",
        "noImplicitAnyLet": "error",
        "noConfusingVoidType": "error",
        "noConsole": "warn"
      }
    }
  },
  "javascript": {
    "globals": []
  }
}
```

Key enforcement choices:
- **`noExplicitAny`: error** — force proper typing everywhere; this is an infra layer, type safety is non-negotiable
- **`noBarrelFile` + `noReExportAll`: error** — explicit imports only, no hidden dependency chains
- **`noNonNullAssertion`: error** — no `!` escapes; handle nullability properly or it'll bite you at runtime (exactly the kind of thing that makes the extension relay flaky)
- **`noAccumulatingSpread`: error** — avoid silent O(n²) in hot paths like action retry loops
- **`noConsole`: warn** — use the structured pino logger, not stray `console.log`
- **`useNodejsImportProtocol`: error** — always `import from 'node:fs'` not `'fs'`, disambiguates Node builtins from npm packages

### 0.3 TypeScript — Strict

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noPropertyAccessFromIndexSignature": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

Notable strict flags beyond `"strict": true`:
- **`exactOptionalPropertyTypes`** — `{ x?: string }` means `string | undefined`, not `string | undefined | missing`. Catches subtle bugs in action option merging.
- **`noUncheckedIndexedAccess`** — `array[i]` returns `T | undefined`. Forces bounds checking on extracted DOM data.
- **`noPropertyAccessFromIndexSignature`** — must use `obj["key"]` for dynamic keys. Makes it clear when you're accessing typed vs. dynamic properties (important for session state).

### 0.4 Package Scripts

```json
{
  "scripts": {
    "check": "biome check .",
    "check:fix": "biome check --fix .",
    "format": "biome format --write .",
    "lint": "biome lint .",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "precommit": "biome check --staged"
  }
}
```

All code must pass `bun check` before commit. No exceptions.

---

## Phase 1 — Browser Pool & Sessions **COMPLETE**

> Goal: Launch, manage, and recover browser instances reliably.

### 1.1 Browser Pool (`pool/browser-pool.ts`)

```typescript
interface BrowserPool {
  // Acquire an isolated browser session, optionally restoring a profile
  acquire(opts?: { profile?: string }): Promise<BrowserSession>
  // Release session back to pool (keeps context alive for reuse)
  release(session: BrowserSession): Promise<void>
  // Force-close a session and its context
  destroy(sessionId: string): Promise<void>
  // Graceful shutdown of all browsers
  shutdown(): Promise<void>
  // Current pool state
  status(): PoolStatus
}
```

- Launches Playwright Chromium with **pinned browser version**
- Pool of 1–4 browser contexts (configurable `maxContexts`)
- Each context is fully isolated (cookies, localStorage, fingerprint)
- Contexts can be **persistent** (saved to disk profile dir) for sites that need login state
- On browser crash: auto-restart within 10s, reassign active sessions

### 1.2 Health Probes (`pool/health.ts`)

- Periodic heartbeat: `page.evaluate(() => document.readyState)` every 30s
- Detects: crashed tabs, hung pages, disconnected CDP
- On failure: mark session unhealthy, notify agent, attempt recovery
- Circuit breaker: if 3 consecutive health checks fail, destroy and recreate context

### 1.3 Sessions (`session/session.ts`)

```typescript
interface BrowserSession {
  id: string
  page: Page                        // active Playwright page
  context: BrowserContext
  profile: string | null            // persistent profile name, if any

  // State
  currentUrl(): string
  isHealthy(): boolean

  // Checkpointing
  snapshot(): Promise<SessionSnapshot>
  restore(snapshot: SessionSnapshot): Promise<void>

  // Lifecycle
  newPage(url?: string): Promise<Page>
  close(): Promise<void>
}

interface SessionSnapshot {
  sessionId: string
  url: string
  cookies: Cookie[]
  localStorage: Record<string, string>
  timestamp: number
}
```

- Wraps Playwright `BrowserContext` + `Page`
- Tracks page lifecycle events (load, domcontentloaded, networkidle)
- `snapshot()` captures full restorable state (URL, cookies, storage)
- `restore()` recreates context from snapshot — survives process restart

### 1.4 Profiles (`session/profiles.ts`)

- Persistent browser profiles stored at `~/.openclaw/browser-profiles/{name}/`
- Preserves login sessions across runs (Agoda, Cebu Pacific, Google, etc.)
- Profile management: create, list, delete, export

---

## Phase 2 — Action Engine **COMPLETE**

> Goal: Every browser action is atomic, verified, and retryable.

### 2.1 Action Base (`actions/action.ts`)

Every action follows the **precondition → execute → verify** cycle from the spec:

```typescript
interface ActionResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
  retries: number
  durationMs: number
  screenshot?: string       // path, taken on failure
}

interface ActionOptions {
  timeout?: 'short' | 'medium' | 'long' | number  // 5s, 15s, 45s, or custom
  retries?: number                                  // default 3
  screenshotOnFailure?: boolean                     // default true
  precondition?: () => Promise<boolean>
  postcondition?: () => Promise<boolean>
}
```

### 2.2 Resilience (`actions/resilience.ts`)

The core reliability layer — this is what makes it better than the extension relay:

- **Bounded retries** with exponential backoff + jitter (100–500ms)
- **Stale element re-resolve**: on `ElementHandleError`, re-query the selector
- **Network stability wait**: wait for `networkidle` before acting, with configurable timeout
- **DOM stability check**: wait for no DOM mutations for 200ms before reading
- **Popup/modal watchdog**: background listener auto-dismisses known interruptions:
  - Cookie consent banners (common selector patterns)
  - Newsletter/promo popups
  - Chat widgets blocking interaction
  - Alert/confirm/prompt dialogs
- **Three timeout tiers**: short (5s) for fast UI, medium (15s) for page loads, long (45s) for heavy SPAs

### 2.3 Selector Strategy (`selectors/strategy.ts`)

Layered resolution — tries each strategy in order until one matches:

```typescript
type SelectorStrategy =
  | { type: 'aria'; role: string; name: string }      // getByRole
  | { type: 'text'; text: string; exact?: boolean }    // getByText
  | { type: 'label'; text: string }                    // getByLabel
  | { type: 'testid'; id: string }                     // getByTestId
  | { type: 'css'; selector: string }                  // CSS fallback
  | { type: 'xpath'; expression: string }              // last resort

// Agent can pass a simple string (CSS) or a layered strategy
type Selector = string | SelectorStrategy | SelectorStrategy[]
```

When given a `SelectorStrategy[]`, the engine tries each in order. This means the agent (or a site-specific config) can define resilient selectors that survive site redesigns.

### 2.4 Core Actions

**Navigation** (`actions/navigate.ts`):
- `navigate(url, opts?)` — goto + wait for ready state
- `reload(opts?)` — reload current page
- `goBack()` / `goForward()` — history navigation
- `waitForNavigation(opts?)` — wait for URL change or page load

**Interaction** (`actions/interact.ts`):
- `click(selector, opts?)` — find element, scroll into view, click, verify state change
- `type(selector, text, opts?)` — clear field, type text, verify input value matches
- `selectOption(selector, value)` — dropdown selection
- `check(selector)` / `uncheck(selector)` — checkbox/radio
- `hover(selector)` — hover with stability wait
- `dragAndDrop(source, target)` — drag between elements
- `fill(fields: Record<string, string>)` — bulk form fill with per-field verification

**Extraction** (`actions/extract.ts`):
- `getText(selector)` → `string`
- `getAttribute(selector, attr)` → `string`
- `getAll(selector, extract?)` → `Array<Record<string, string>>` — table/list scraping
- `getPageContent()` → cleaned text content of page
- `evaluateExtract<T>(fn)` → run arbitrary extraction function in page context

**Wait** (`actions/wait.ts`):
- `waitForSelector(selector, opts?)` — visible, hidden, attached, detached
- `waitForCondition(fn, opts?)` — arbitrary JS condition in page
- `waitForNetworkIdle(opts?)` — no pending requests for N ms
- `waitForUrl(pattern)` — URL matches string or regex

**Page** (`actions/page.ts`):
- `screenshot(label?)` → saves to artifacts, returns path
- `pdf(label?)` → saves PDF
- `evaluate<T>(fn)` → run JS in page context
- `scroll(direction, amount?)` — scroll page or element
- `getPageState()` → `{ url, title, readyState, isLoading }`

---

## Phase 3 — State Persistence & Artifacts

> Goal: Survive crashes. Keep evidence of everything.

### 3.1 SQLite Store (`store/db.ts`)

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  profile TEXT,
  status TEXT NOT NULL,           -- active | suspended | closed
  snapshot TEXT,                   -- JSON SessionSnapshot
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  action TEXT NOT NULL,            -- navigate, click, type, extract, etc.
  selector TEXT,
  input TEXT,                      -- JSON action params
  result TEXT,                     -- JSON ActionResult
  screenshot_path TEXT,
  duration_ms INTEGER,
  retries INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
```

- Every action is logged with input, result, timing, and retry count
- Session snapshots persisted on every significant state change
- On process restart: list suspended sessions, agent can choose to restore

### 3.2 Artifacts (`store/artifacts.ts`)

- Base path: `~/.openclaw/workspace/browser-automation/artifacts/`
- Structure: `{sessionId}/{timestamp}-{action}-{label}.png`
- Screenshots on: every failure, explicit capture, session suspend
- DOM snapshots (cleaned HTML) on extraction actions
- Retention: configurable, default keep last 100 sessions

---

## Phase 4 — Observability

> Goal: When something breaks, know exactly what happened.

### 4.1 Structured Logger (`observe/logger.ts`)

- Pino JSON logger
- Every log entry includes: `sessionId`, `action`, `selector`, `durationMs`, `retries`, `ok`
- Log levels: `debug` (DOM details), `info` (action outcomes), `warn` (retries), `error` (failures)
- Outputs to: stdout (OpenClaw captures) + rotating file

### 4.2 Action Traces (`observe/trace.ts`)

- Per-session action timeline: ordered list of `{ action, time, duration, result }`
- Queryable by the agent: "what happened in this session?"
- Enables post-mortem debugging: agent can read the trace and explain failures
- Simple in-process counters:
  - `actions_total` by type and outcome
  - `retries_total`
  - `sessions_total` by status
  - `action_p50_ms`, `action_p95_ms`

---

## Phase 5 — OpenClaw Skill Integration

> Goal: Clawbot can drive any browser task via tool calls.

### 5.1 Tool Definitions (`tools/`)

These are the tools the AI agent calls. They map directly to the engine capabilities:

**Session Tools** (`tools/session-tools.ts`):

| Tool | Input | Output | Description |
|---|---|---|---|
| `browser_open` | `{ url?, profile? }` | `{ sessionId, url }` | Open a new browser session |
| `browser_close` | `{ sessionId }` | `{ ok }` | Close a session |
| `browser_list` | `{}` | `{ sessions[] }` | List active sessions |
| `browser_restore` | `{ sessionId }` | `{ ok, url }` | Restore a suspended session |
| `browser_state` | `{ sessionId }` | `{ url, title, isLoading }` | Get current page state |

**Action Tools** (`tools/action-tools.ts`):

| Tool | Input | Output | Description |
|---|---|---|---|
| `browser_navigate` | `{ sessionId, url }` | `{ ok, url }` | Navigate to URL |
| `browser_click` | `{ sessionId, selector }` | `{ ok }` | Click an element |
| `browser_type` | `{ sessionId, selector, text }` | `{ ok }` | Type into a field |
| `browser_select` | `{ sessionId, selector, value }` | `{ ok }` | Select dropdown option |
| `browser_fill_form` | `{ sessionId, fields }` | `{ ok, filled }` | Fill multiple form fields |
| `browser_extract_text` | `{ sessionId, selector }` | `{ text }` | Get element text |
| `browser_extract_all` | `{ sessionId, selector, attrs? }` | `{ items[] }` | Extract list/table data |
| `browser_wait` | `{ sessionId, selector?, condition? }` | `{ ok }` | Wait for element/condition |

**Page Tools** (`tools/page-tools.ts`):

| Tool | Input | Output | Description |
|---|---|---|---|
| `browser_screenshot` | `{ sessionId, label? }` | `{ path }` | Capture screenshot |
| `browser_evaluate` | `{ sessionId, script }` | `{ result }` | Run JS in page |
| `browser_scroll` | `{ sessionId, direction }` | `{ ok }` | Scroll the page |
| `browser_get_content` | `{ sessionId }` | `{ content }` | Get page text content |

**Approval Tool** (`tools/approval-tools.ts`):

| Tool | Input | Output | Description |
|---|---|---|---|
| `browser_request_approval` | `{ sessionId, message }` | `{ approved }` | Ask user before irreversible action |

### 5.2 Skill Manifest (`index.ts`)

```typescript
export default {
  name: 'browser-automation',
  description: 'Reliable browser automation — navigate, interact, extract, fill forms on any website',
  version: '0.1.0',
  tools: [
    ...sessionTools,
    ...actionTools,
    ...pageTools,
    ...approvalTools,
  ],
  onLoad: async (ctx) => {
    // Initialize browser pool
    // Set up SQLite store
    // Register popup dismiss patterns
  },
  onUnload: async (ctx) => {
    // Graceful shutdown — suspend active sessions, close browsers
  },
}
```

---

## Phase 6 — Integration Tests

> Goal: Prove reliability before trusting it with real tasks.

| Test | What it validates |
|---|---|
| Pool launch + acquire + release (20 cycles) | Session lifecycle is leak-free |
| Navigate + extract on 10 different sites | Actions work across real-world DOMs |
| Kill Chromium process mid-session, restore | Crash recovery within 10s |
| Cookie banner auto-dismiss on 5 sites | Popup watchdog works |
| Fill and submit a form (httpbin or similar) | End-to-end form interaction |
| Concurrent sessions (4 parallel) | Pool isolation holds |
| Action retry on flaky element (simulate with delayed DOM) | Resilience logic works |
| Agent-driven multi-step sequence (open → nav → extract → screenshot → close) | Full tool chain works via OpenClaw |
| Session suspend + process restart + restore | Checkpoint persistence works |

Target: **95%+ pass rate** on 10 consecutive full-suite runs.

---

## Implementation Order

| Phase | Effort | Deliverable |
|---|---|---|
| **1 — Pool & Sessions** | ~3 days | Browser launches, sessions work, snapshots save/restore |
| **2 — Action Engine** | ~4 days | All core actions with retry/verify, selector strategy, popup dismiss |
| **3 — Persistence** | ~2 days | SQLite store, action log, artifact management |
| **4 — Observability** | ~1 day | Structured logging, action traces |
| **5 — Skill Integration** | ~2 days | All tools registered, agent can drive sessions |
| **6 — Integration Tests** | ~2 days | Test suite passes at 95%+ |

**Total: ~2 weeks to a working, reliable browser channel for clawbot.**

---

## Dependencies

| Package | Purpose | Notes |
|---|---|---|
| `playwright-core` | Browser automation | Already in OpenClaw |
| `zod` | Tool input validation | Already in OpenClaw |
| `better-sqlite3` | State persistence | ~2MB, zero config |
| `pino` | Structured logging | Fast JSON logger |
| `nanoid` | Session/correlation IDs | Tiny, no deps |

No new infrastructure. No external services. Just a skill that makes the browser work.

---

## What This Enables

Once this layer is reliable, clawbot can:

- **Book flights/hotels** — the booking workflow from SPEC.md becomes a sequence of tool calls the agent composes
- **Fill government forms** — navigate, extract field labels, fill, screenshot confirmation
- **Monitor prices** — open session, navigate, extract, compare, close
- **Research** — open multiple sessions, extract content, compare
- **Manage accounts** — login (via persistent profile), navigate settings, make changes
- **Any browser task** — the agent has the same primitives a human has: navigate, read, click, type, wait

The agent is the workflow engine. This layer is the reliable hands.

---

## What v1 Defers

- **No extension relay integration** — clean break, Playwright only
- **No multi-machine** — single process, single host
- **No video recording** — screenshots are enough for v1
- **No request interception** — add when needed for specific sites
- **No stealth/fingerprint rotation** — add if bot detection becomes a problem
- **No built-in workflows** — the agent composes actions; domain-specific workflows are separate skills
