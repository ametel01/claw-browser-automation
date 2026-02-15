# FIXES.md Implementation Plan

## Context

The browser automation layer has 10 improvements specified in `FIXES.md`. After auditing the codebase, 1 item is already done (#2 state-based waits), 5 are partial, and 2 are fully missing. This plan implements all remaining work across 5 phases, building foundational pieces first.

## Current State

| # | Improvement | Status | Key Gap |
|---|-------------|--------|---------|
| 1 | Postcondition checks | PARTIAL | Need declarative assertion helpers |
| 2 | State-based waits | **DONE** | Skip |
| 3 | Robust input modes | PARTIAL | Need paste + nativeSetter modes |
| 4 | Semantic actions | PARTIAL | Need setField, submitForm, applyFilter |
| 5 | Selector confidence | PARTIAL | Need resolution metadata reporting |
| 6 | Stable element handles | **MISSING** | Full handle registry needed |
| 7 | Structured extraction | PARTIAL | Need schema-based extraction + provenance |
| 8 | Trace enrichment | PARTIAL | Need selector/events/waits detail in traces |
| 9 | Idempotent retries | PARTIAL | Need nav guard, dedup, alternate strategies |
| 10 | Error taxonomy | **MISSING** | Full typed error hierarchy needed |

---

## Phase 1: Foundation — Error Taxonomy (#10) + Selector Confidence (#5) **COMPLETE**

These are cross-cutting primitives that most other phases depend on.

### #10 — Error Taxonomy

**Create `src/errors.ts`** with typed error classes:
- `BrowserAutomationError` (base) — has `code`, `message`, `recoveryHint`
- `TargetNotFoundError` — selector didn't match
- `StaleElementError` — handle/element no longer valid
- `AssertionFailedError` — postcondition/verification failure
- `NavigationInterruptedError` — page navigated during action
- `TimeoutExceededError` — operation timed out
- `SessionUnhealthyError` — browser context is broken

**Modify `src/actions/action.ts`**:
- Add `StructuredError` type: `{ code: string; message: string; recoveryHint: string }`
- Add helper `toStructuredError(err: unknown): string | StructuredError`
- Update `buildFailureResult` to produce structured errors when the caught error is a `BrowserAutomationError`
- `ActionResult.error` stays `string` for untyped errors (backward compat)

**Modify `src/selectors/strategy.ts`**: Throw `TargetNotFoundError` instead of generic Error.

**Modify `src/actions/interact.ts`**: Verification failures throw `AssertionFailedError`.

**Modify `src/actions/navigate.ts`**: Navigation failures throw `NavigationInterruptedError`.

### #5 — Selector Confidence Reporting

**Add to `src/selectors/strategy.ts`**:
```typescript
export interface SelectorResolution {
  locator: Locator;
  strategy: SelectorStrategy;   // which strategy matched
  strategyIndex: number;        // index in fallback chain
  resolutionMs: number;         // resolution time
  chainLength: number;          // total strategies in chain
}
```

- Refactor `resolveBestSelector` to return `SelectorResolution`
- Keep `resolveFirstVisible` returning `Locator` (extracts `.locator.first()` internally) — no breaking change to interact.ts callers
- Add new export `resolveWithConfidence` returning full `SelectorResolution`
- Update direct callers of `resolveBestSelector`: `extract.ts` (`getAll`), `wait.ts` (`waitForSelector`)

### Files

| Action | File |
|--------|------|
| Create | `src/errors.ts` |
| Create | `tests/errors/errors.test.ts` |
| Modify | `src/actions/action.ts` |
| Modify | `src/selectors/strategy.ts` |
| Modify | `src/actions/interact.ts` |
| Modify | `src/actions/navigate.ts` |
| Modify | `src/actions/extract.ts` |
| Modify | `src/actions/wait.ts` |
| Modify | `src/index.ts` |

---

## Phase 2: Action Engine Hardening — Assertions (#1), Traces (#8), Retries (#9) **COMPLETE**

### #1 — Declarative Postcondition Assertions

**Create `src/actions/assertions.ts`** with helpers that return `(ctx: ActionContext) => Promise<boolean>`:
- `assertUrlContains(substring)`
- `assertElementVisible(selector)`
- `assertElementText(selector, expected: string | RegExp)`
- `assertElementGone(selector)`
- `allOf(...checks)` — compose multiple assertions

These are pure factory functions compatible with existing `ActionOptions.postcondition`. No changes to `executeAction` needed.

### #8 — Trace Enrichment

**Expand `TraceEntry` in `src/observe/trace.ts`** with optional fields:
- `selectorResolved?: { strategy: string; strategyIndex: number; resolutionMs: number }`
- `eventsDispatched?: string[]`
- `waitsPerformed?: string[]`
- `assertionsChecked?: string[]`

**Add `TraceMetadata` to `ActionContext`** in `src/actions/action.ts`:
- `_traceMeta?: TraceMetadata` — mutable bag, reset per `executeAction` call
- Action implementations populate it as they resolve selectors and perform waits
- `recordTraceEntry` includes metadata in the trace entry

### #9 — Idempotent Retries with Guardrails

**Modify retry loop in `src/actions/action.ts`**:
1. **Navigation guard**: Record `page.url()` at action start. On retry, if URL changed → abort with `NavigationInterruptedError`
2. **Duplicate click prevention**: Track last click target + timestamp in `_retryState` on ActionContext. Skip if same selector clicked within 500ms
3. **Alternate selector**: When retry is caused by `TargetNotFoundError` and selector is an array, rotate failed strategy to end of chain

### Files

| Action | File |
|--------|------|
| Create | `src/actions/assertions.ts` |
| Create | `tests/actions/assertions.test.ts` |
| Modify | `src/actions/action.ts` |
| Modify | `src/actions/interact.ts` |
| Modify | `src/actions/extract.ts` |
| Modify | `src/actions/wait.ts` |
| Modify | `src/observe/trace.ts` |
| Modify | `src/index.ts` |

---

## Phase 3: Input Modes (#3) + Structured Extraction (#7)

### #3 — Robust Input Modes

**Add `mode` to `TypeOptions`** in `src/actions/interact.ts`:
```typescript
mode?: "fill" | "sequential" | "paste" | "nativeSetter";
```

- `fill` (default) — existing `locator.fill()` with verification
- `sequential` — existing `locator.pressSequentially()`
- `paste` — `locator.evaluate()` dispatching ClipboardEvent with DataTransfer
- `nativeSetter` — `locator.evaluate()` using `HTMLInputElement.prototype.value` setter + dispatching `input`/`change`/`blur` events (for React/Vue controlled inputs)

Keep `sequential` boolean for backward compat; `mode` takes precedence when set.

**Update `browser_type` tool** in `src/tools/action-tools.ts` to expose `mode` parameter.

### #7 — Structured Extraction API

**Create `src/actions/extract-structured.ts`**:
- `extractStructured<S>(ctx, selector, schema, opts)` using TypeBox schemas
- Schema property names map to HTML attributes (with special `textContent`/`innerHTML`)
- Returns `ExtractionResult<T>` with `data: T[]` and `provenance` array tracking which node produced each item (tagName, id, className, strategy used)
- Validates output against schema via `@sinclair/typebox/value`

**Add `browser_extract_structured` tool** in action-tools.ts accepting a JSON field mapping.

### Files

| Action | File |
|--------|------|
| Create | `src/actions/extract-structured.ts` |
| Create | `tests/actions/extract-structured.test.ts` |
| Modify | `src/actions/interact.ts` |
| Modify | `src/tools/action-tools.ts` |
| Modify | `src/index.ts` |

---

## Phase 4: Stable Element Handles (#6)

Highest risk item — entirely opt-in, doesn't break existing tools.

### Handle Registry

**Create `src/session/handle-registry.ts`**:
- `HandleRegistry` class — per-session, maps stable IDs to selector strategies
- `register(selector)` → resolves element, returns `ElementHandle` with `handleId`
- `resolve(handleId)` → tries last known strategy first, falls back to full re-resolution, reports if remapped
- `release(handleId)` / `clear()` — cleanup
- Tracks `remapCount` per handle for observability

**Add to `BrowserSession`** in `src/session/session.ts`: lazy `handleRegistry` property.

**Create `src/tools/handle-tools.ts`** with 3 tools:
- `browser_register_element` — register selector, get handleId
- `browser_resolve_element` — check if handle still valid
- `browser_release_element` — release a handle

**Update action tools** in `src/tools/action-tools.ts`:
- Click/type/select/extract tools accept `handleId` as alternative to `selector`
- Add `resolveLocatorParam` helper in `src/tools/context.ts`

### Files

| Action | File |
|--------|------|
| Create | `src/session/handle-registry.ts` |
| Create | `src/tools/handle-tools.ts` |
| Create | `tests/session/handle-registry.test.ts` |
| Modify | `src/session/session.ts` |
| Modify | `src/tools/context.ts` |
| Modify | `src/tools/action-tools.ts` |
| Modify | `src/index.ts` |

---

## Phase 5: Semantic Actions (#4)

Builds on all prior phases (assertions, input modes, selector strategies).

### Semantic Action Functions

**Create `src/actions/semantic.ts`**:
- `setField(ctx, identifier, value, opts)` — finds input by label/placeholder/name/aria-label (fallback chain), sets value using best input mode
- `submitForm(ctx, scope?, opts)` — finds submit button within form scope using strategy chain (`button[type=submit]` → `input[type=submit]` → default button → aria role)
- `applyFilter(ctx, fieldIdentifier, value, opts)` — composes `setField` + optional apply/search button click

**Create `src/tools/semantic-tools.ts`** with 3 tools:
- `browser_set_field` — set field by label/name/placeholder
- `browser_submit_form` — find and click submit
- `browser_apply_filter` — set filter + click apply

### Files

| Action | File |
|--------|------|
| Create | `src/actions/semantic.ts` |
| Create | `src/tools/semantic-tools.ts` |
| Create | `tests/actions/semantic.test.ts` |
| Modify | `src/index.ts` |

---

## Verification

After each phase:
1. `bun run build` — TypeScript compilation clean
2. `bunx biome check --write .` — Biome lint clean
3. `bun test` — no new test failures (33 pre-existing failures from better-sqlite3/Bun compat are expected)

After all phases:
- Tool count increases from 19 to ~25 (3 handle tools + 3 semantic tools)
- All new tools follow `browser_*` naming convention
- All new tools have labels, descriptions, and TypeBox parameter schemas

## Risk Summary

| Phase | Risk | Mitigation |
|-------|------|------------|
| 1 | Low | Backward-compat: resolveFirstVisible unchanged |
| 2 | Medium | _traceMeta is internal, additive to TraceEntry |
| 3 | Low | New modes are opt-in, existing fill/sequential unchanged |
| 4 | High | Entirely opt-in, no changes to existing tool behavior |
| 5 | Medium | Composes existing primitives, no new low-level logic |
