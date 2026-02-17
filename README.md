# claw-browser-automation

Reliable browser automation layer for [OpenClaw](https://github.com/openclaw/openclaw). Replaces the flaky extension relay with managed Playwright sessions that the AI agent drives directly.

The agent (clawbot) is the workflow engine — it decides *what* to do. This layer provides reliable *how*: atomic browser actions with postcondition verification, automatic retries, session persistence, and full observability.

```
┌─────────────────────────────────────────────────┐
│  OpenClaw Agent (clawbot)                       │
│  - Receives user intent via any channel         │
│  - Decides what browser actions to take         │
│  - Calls browser tools exposed by this skill    │
└──────────────┬──────────────────────────────────┘
               │ tool calls
┌──────────────▼──────────────────────────────────┐
│  claw-browser-automation (this project)         │
│                                                 │
│  Tool Layer → Action Engine → Browser Pool      │
│                    │                            │
│         State & Artifacts (SQLite)              │
└──────────────┬──────────────────────────────────┘
               │
    ┌──────────▼──────────┐
    │  Chromium (managed)  │
    └─────────────────────┘
```

## Prerequisites

- **Node.js** >= 22.12.0
- **Bun** (package manager)
- **OpenClaw** >= 2026.2.9 installed globally
- **Playwright browsers** installed (`npx playwright install chromium`)

## Quick start

### 1. Install as an OpenClaw plugin

```bash
openclaw plugins install claw-browser-automation
```

### 2. Install Playwright browsers (first time only)

```bash
npx playwright install chromium
```

### 3. Configure (optional)

All configuration has sensible defaults. To customize, edit `~/.openclaw/openclaw.json`:

```jsonc
{
  "plugins": {
    "entries": {
      "claw-browser-automation": {
        "enabled": true,
        "config": {
          "maxContexts": 4,
          "headless": true,
          "autoApprove": false,
          "sitePlugins": [
            { "module": "@yourorg/claw-plugin-twitter" },
            { "module": "@yourorg/claw-plugin-agoda", "options": { "locale": "en-US" } }
          ]
        }
      }
    }
  }
}
```

### 4. Start OpenClaw

```bash
openclaw start
```

The browser automation plugin loads automatically. The agent now has access to 19 browser tools and can perform any browser task you ask for via Telegram, the CLI, or any other configured channel.

### Alternative: install from source

If you prefer to work from a local checkout instead of the published package:

```bash
git clone https://github.com/ametel01/claw-browser-automation
cd claw-browser-automation
bun install
bun run build
```

Then point OpenClaw at the source tree in `~/.openclaw/openclaw.json`:

```jsonc
{
  "skills": {
    "load": {
      "extraDirs": ["/path/to/claw-browser-automation"]
    }
  }
}
```

### Programmatic usage

You can also use the library directly without OpenClaw:

```typescript
import { createSkill } from "claw-browser-automation";

const skill = await createSkill({
  maxContexts: 4,
  headless: true,
  approvalProvider: async ({ sessionId, message }) => {
    // Implement host-mediated approval here.
    return true;
  },
});

// skill.tools — array of 19 ToolDefinition objects
// skill.context — internal state (pool, store, trace, etc.)
// skill.shutdown() — graceful shutdown
```

## How it works with OpenClaw

When you send a message like "go to example.com and extract the main heading", the flow is:

1. **You** send a message via Telegram / CLI / API
2. **OpenClaw agent** receives the intent and plans a tool sequence
3. **Agent calls** `browser_open` → `browser_navigate` → `browser_extract_text` → `browser_close`
4. **This skill** executes each tool against a managed Playwright browser
5. **Agent returns** the extracted data to you

The agent composes tools into arbitrary workflows. This layer doesn't hardcode any specific task — it provides primitives the agent chains together.

## Available tools

The skill exposes 19 tools to the agent, grouped by function:

### Session management

| Tool | Description |
|------|-------------|
| `browser_open` | Open a new browser session, optionally with a URL or named profile |
| `browser_close` | Close session and save a snapshot for later restore |
| `browser_list` | List all active sessions with URLs and health status |
| `browser_restore` | Restore a previously suspended session from its snapshot |
| `browser_state` | Get current page state (URL, title, loading status) |

### Page actions

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to a URL and wait for load |
| `browser_click` | Click an element by CSS selector |
| `browser_type` | Type text into an input field |
| `browser_select` | Select a dropdown option |
| `browser_fill_form` | Fill multiple form fields at once |
| `browser_wait` | Wait for an element state or a JS condition |

### Data extraction

| Tool | Description |
|------|-------------|
| `browser_extract_text` | Extract text content from a single element |
| `browser_extract_all` | Extract data from all matching elements (lists, tables) |
| `browser_get_content` | Get cleaned page text (scripts/styles removed) |

### Page utilities

| Tool | Description |
|------|-------------|
| `browser_screenshot` | Capture a screenshot and save as artifact |
| `browser_evaluate` | Execute arbitrary JavaScript in the page |
| `browser_scroll` | Scroll the page in a direction |
| `browser_session_trace` | Get the full action trace for a session |

### Safety

| Tool | Description |
|------|-------------|
| `browser_request_approval` | Pause and ask the human for confirmation before proceeding |

## Configuration

All configuration is optional. Defaults work out of the box.

| Option | Default | Description |
|--------|---------|-------------|
| `maxContexts` | `4` | Maximum concurrent browser sessions |
| `headless` | `true` | Run browsers without a visible window |
| `dbPath` | `~/.openclaw/browser-automation/store.db` | SQLite database for session persistence |
| `artifactsDir` | `~/.openclaw/workspace/browser-automation/artifacts` | Screenshot and DOM snapshot storage |
| `artifactsMaxSessions` | `100` | Max artifact session directories retained before oldest are removed |
| `redactSensitiveActionInput` | `true` | Redact known sensitive action-input keys before persisting action logs |
| `sensitiveActionInputKeys` | built-in list + custom keys | Additional action-input keys to redact (merged with defaults) |
| `redactTypedActionText` | `false` | Redact typed/evaluated text payloads (`text`, `value`, `fields`, `script`) |
| `autoApprove` | unset | Approval fallback when no provider exists; if unset, falls back to `BROWSER_AUTO_APPROVE=1` |
| `sitePlugins` | `[]` | Dynamic website-specific plugin modules loaded at startup |
| `logLevel` | `info` | Log level (`debug`, `info`, `warn`, `error`) |

Pass these via the `config` key in your `openclaw.json` skill entry, or programmatically via `createSkill()` (see [Quick start](#quick-start)).

`approvalProvider` is available in programmatic usage only (`createSkill`). If no provider is supplied, `browser_request_approval` falls back to `BROWSER_AUTO_APPROVE=1`.

Each `sitePlugins` entry accepts:
- `module`: npm package name or import path for the plugin module
- `enabled` (optional): set `false` to disable a configured plugin
- `options` (optional): plugin-specific JSON options passed to plugin factory exports

`sitePlugins[].module` supports:
- npm package names from your project dependencies (example: `@yourorg/claw-plugin-twitter`)
- relative paths from the OpenClaw process working directory (example: `./plugins-examples/twitter-plugin/dist/index.js`)
- absolute paths and `file://` URLs

Plugin modules can export any of these shapes:
- default plugin object (`{ meta, createTools }`)
- default factory function (`(options, logger) => plugin`)
- named `createSitePlugin` factory
- CommonJS-compatible `default.createSitePlugin` factory

### Plugin examples

This repository includes two example external plugins:

- `plugins-examples/generic-plugin` — generic cross-site example (`example_site`)
- `plugins-examples/twitter-plugin` — domain-specific X/Twitter-style example (`twitter_site`)

You can load either using a local module path in `sitePlugins`:

```json
{
  "sitePlugins": [
    { "module": "./plugins-examples/generic-plugin/dist/index.js" },
    { "module": "./plugins-examples/twitter-plugin/dist/index.js" }
  ]
}
```

## Reliability features

These are the mechanisms that make this layer production-grade compared to an extension relay:

- **3-tier timeouts** — short (5s), medium (15s), long (45s) per action type
- **Exponential backoff retries** with jitter on every action
- **DOM stability checks** before reads and clicks (MutationObserver-based)
- **Automatic popup/cookie banner dismissal** — recognizes 13 common patterns
- **Health probes with circuit breaker** — detects browser crashes, auto-restarts
- **Session-ID preserving crash recovery** — unhealthy sessions are recreated without changing `sessionId`
- **Session snapshots** — URL, cookies, localStorage checkpointed to SQLite
- **Pre/postcondition verification** per action
- **Layered selector resolution** — CSS, ARIA, text, label, test ID, XPath with fallback chains

## Data persistence

All session state survives process restarts:

```

Artifact retention is enforced automatically at startup, shutdown, and after screenshot captures.
~/.openclaw/browser-automation/
├── store.db              # SQLite: sessions, action log, schema
└── ...

~/.openclaw/workspace/browser-automation/
├── artifacts/
│   └── {sessionId}/      # Screenshots and DOM snapshots per session
└── logs/
    └── browser-automation-YYYY-MM-DD.log
```

The agent can suspend a session, shut down, restart hours later, and resume exactly where it left off — same URL, same cookies, same localStorage.

## Development

### Scripts

```bash
bun run build        # Compile TypeScript to dist/
bun run test         # Run all tests (183 tests across 12 files)
bun run test:watch   # Watch mode
bun run check        # Biome lint + format check
bun run check:fix    # Auto-fix lint/format issues
bun run typecheck    # TypeScript strict mode check
bun run verify       # Verify all quality checks and tests pass
```

### Running integration tests

The integration tests prove end-to-end reliability across 9 scenarios: pool lifecycle, DOM extraction, crash recovery, popup dismissal, form filling, concurrent sessions, action retry, full tool chain, and session suspend/restore.

```bash
# Single run
bun run test -- tests/integration/integration.test.ts

# Reliability check (10 consecutive passes required)
for i in {1..10}; do bun run test -- tests/integration/integration.test.ts || exit 1; done
```

### Project structure

```
src/
├── index.ts                # Library entry point — createSkill()
├── plugin.ts               # OpenClaw plugin adapter — register(api)
├── pool/
│   ├── browser-pool.ts     # Session lifecycle, max-context enforcement
│   └── health.ts           # Health probes, circuit breaker recovery
├── session/
│   ├── session.ts          # BrowserSession with snapshot/restore
│   ├── snapshot.ts         # SessionSnapshot type (URL, cookies, localStorage)
│   └── profiles.ts         # Named profile persistence
├── actions/
│   ├── action.ts           # executeAction framework (retries, timeouts, tracing)
│   ├── interact.ts         # click, type, fill, select, check, hover, drag
│   ├── extract.ts          # getText, getAll, getPageContent
│   ├── navigate.ts         # navigate, reload, goBack, goForward
│   ├── wait.ts             # waitForSelector, waitForCondition, waitForNetworkIdle
│   ├── page.ts             # screenshot, evaluate, scroll, getPageState
│   └── resilience.ts       # PopupDismisser, waitForDomStability
├── selectors/
│   └── strategy.ts         # Layered selector resolution (CSS/ARIA/text/label/xpath)
├── store/
│   ├── db.ts               # SQLite with auto-migrations
│   ├── sessions.ts         # SessionStore (CRUD + suspend/restore)
│   ├── action-log.ts       # Every action logged with timing and result
│   └── artifacts.ts        # Screenshot/snapshot storage with retention
├── observe/
│   ├── logger.ts           # Pino structured logging (stdout + file)
│   └── trace.ts            # Per-session action traces with p50/p95 stats
└── tools/
    ├── context.ts          # SkillContext type, helper functions
    ├── session-tools.ts    # browser_open, close, list, restore, state
    ├── action-tools.ts     # browser_navigate, click, type, fill, extract, wait
    ├── page-tools.ts       # browser_screenshot, evaluate, scroll, trace
    └── approval-tools.ts   # browser_request_approval
```

## License

MIT
