# Incremental Improvement Review

## Scope

Reviewed the current codebase as a stable, working system and looked for low-risk, incremental improvements that raise reliability, operability, and maintainability without changing the core architecture.

## What Is Already Strong

- Clear layered design: tools -> actions -> pool/session -> persistence.
- Good reliability primitives already present: retries, timeout tiers, DOM stability waits, health probing, snapshot/restore.
- Solid test footprint and clear module boundaries.

## Prioritized Findings

## P1: Config Surface Mismatch (`logLevel` is declared but not wired) **COMPLETED**

- Why it matters:
- Operators cannot set logger level through plugin config even though the public config type suggests they can.
- This causes confusion and makes runtime tuning harder in production.
- Evidence:
- `SkillConfig` includes `logLevel` in `src/index.ts:24`.
- `createSkill` always calls `createLogger("browser-automation")` without config in `src/index.ts:34`.
- Plugin config resolver does not map `logLevel` in `src/plugin.ts:6`.
- Plugin schema does not expose `logLevel` in `openclaw.plugin.json:5`.
- Incremental change:
- Add `logLevel` to `openclaw.plugin.json`.
- Parse `logLevel` in `resolveConfig` (`src/plugin.ts`).
- Update logger factory to accept optional level and pass `config.logLevel` from `createSkill`.
- Estimated risk/effort:
- Low risk, small patch.

## P1: Retry Count Reporting Is Inaccurate on Some Failures **COMPLETED**

- Why it matters:
- Action metrics, logs, and failure analytics can over-report retries, making debugging and SLO measurement noisy.
- Evidence:
- On failure, result always records `retries: maxRetries` in `src/actions/action.ts:263`.
- Same value logged in error path at `src/actions/action.ts:281`.
- Incremental change:
- Track actual attempts performed in `retryLoop` for exhausted paths and propagate that into `buildFailureResult`.
- Add a targeted test for early exhaustion scenarios (for example navigation guard path) to lock in behavior.
- Estimated risk/effort:
- Low risk, small-to-medium patch.

## P1: Session Recovery Replaces Session IDs Without Persisted-State Reconciliation **COMPLETED**

- Why it matters:
- Auto-recovery currently creates a replacement `session.id`. External actors and persisted stores keyed by old ID can drift.
- This can cause stale session references in long-running agent flows.
- Evidence:
- Unhealthy recovery creates a new `BrowserSession` and stores it under a new ID in `src/pool/browser-pool.ts:257` and `src/pool/browser-pool.ts:268`.
- Session tooling already treats restore as old-ID closed/new-ID active (`src/tools/session-tools.ts:107`), but pool-level auto-recovery has no equivalent store sync hook.
- Incremental change:
- Introduce a pool recovery callback/event with `{ oldSessionId, newSessionId }`.
- Consume it in skill context to update `SessionStore` status and optional alias mapping.
- Estimated risk/effort:
- Medium risk, medium patch.

## P1: In-Memory Trace Storage Is Unbounded **COMPLETED**

- Why it matters:
- For long-lived processes, trace arrays can grow indefinitely and increase memory pressure.
- Evidence:
- Trace entries and durations are appended continuously (`src/observe/trace.ts:32`, `src/observe/trace.ts:33`, `src/observe/trace.ts:45`, `src/observe/trace.ts:47`).
- No cap or TTL exists in the trace structure.
- Incremental change:
- Add configurable caps (for example max entries per session and max global durations tracked for percentiles).
- Evict oldest entries with a ring-buffer approach.
- Estimated risk/effort:
- Low-to-medium risk, medium patch.

## P2: Artifact Retention Exists but Is Not Scheduled/Invoked **COMPLETED**

- Why it matters:
- Artifacts can grow unbounded in disk usage during heavy automation.
- Evidence:
- Retention method exists at `src/store/artifacts.ts:122`.
- No invocation from startup/shutdown/tool paths was found.
- Incremental change:
- Call `artifacts.enforceRetention()` during skill startup and shutdown.
- Invoke retention after successful screenshot actions.
- Add `artifactsMaxSessions` to `SkillConfig` / plugin config for threshold control.
- Estimated risk/effort:
- Low risk, small patch.

## P2: Shutdown Path Does Not Persist Named Profile Snapshots via Pool Profile Store **COMPLETED**

- Why it matters:
- `release/destroy` persist profile snapshots, but pool shutdown closes sessions directly.
- In crash/stop scenarios, named profile snapshots may lag behind latest session state.
- Evidence:
- Profile snapshots are persisted in `release` and `destroy` (`src/pool/browser-pool.ts:95`, `src/pool/browser-pool.ts:103`).
- `shutdown` closes sessions without calling `_persistProfileSnapshot` (`src/pool/browser-pool.ts:138`).
- Skill shutdown stores DB snapshots (`src/index.ts:81`) but that is a different persistence channel than profile snapshots.
- Incremental change:
- Persist named profile snapshots per active session before shutdown closes each session.
- Keep existing DB snapshot behavior unchanged.
- Estimated risk/effort:
- Low-to-medium risk, small patch.

## P2: Sensitive Input Logging Should Be Configurable/Redacted **COMPLETED**

- Why it matters:
- Action logs currently persist raw scripts and typed values, which can include credentials or PII.
- Evidence:
- `browser_evaluate` logs full script input (`src/tools/page-tools.ts:65`).
- `browser_type` and `browser_fill_form` log raw field values (`src/tools/action-tools.ts:153`, `src/tools/action-tools.ts:212`).
- Inputs are serialized directly into SQLite action_log (`src/store/action-log.ts:70`).
- Incremental change:
- Implemented configurable `ActionLog` redaction policy and wired it into `createSkill`.
- Added plugin schema and config resolution:
  - `redactSensitiveActionInput` (default `true`)
  - `sensitiveActionInputKeys` (defaults to known sensitive key set; user override supported)
  - `redactTypedActionText` (default `false`)
- Added targeted action-log tests for:
  - default sensitive-key redaction
  - configurable key list
  - typed-text redaction (including `fields` maps)
  - opt-out from redaction
- `ActionLog` now recursively sanitizes structured input before persistence, with parent-key context propagation for map-like typed payloads.
- Estimated risk/effort:
- Completed with low-medium risk.

## P3: Approval Tool Is Environment-Flag Only

- Why it matters:
- For production workflows, approval should ideally integrate with the host approval channel instead of only relying on env toggles.
- Evidence:
- Approval decision is computed via `process.env["BROWSER_AUTO_APPROVE"]` in `src/tools/approval-tools.ts:26`.
- Incremental change:
- Add an injectable approval callback/provider in skill config.
- Keep env fallback for local/dev usage.
- Estimated risk/effort:
- Medium risk, medium patch.

## Suggested Execution Order

1. Wire `logLevel` end-to-end.
2. Fix retry-attempt accounting in failure results.
3. Add artifact retention invocation.
4. Add optional log redaction.
5. Add recovery session-ID reconciliation hook.
6. Add trace caps/eviction.
7. Improve approval-provider integration.

## Notes

- No critical correctness regressions were identified in this pass.
- The strongest improvements now are operational: observability accuracy, state reconciliation, and storage hygiene.
