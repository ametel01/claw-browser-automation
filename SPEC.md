Bruno The Claw, [2/15/26 4:14 AM]
Awesome prompt. If you want a truly reliable browser automation channel (for real booking tasks, unattended), you need to treat it like production infra, not a browser plugin trick.

Here’s the detailed blueprint.


0) Reliability target first (define success)

Set explicit SLOs:

• Session attach success: >99%
• Action success (click/type/navigate): >98%
• State desync incidents: <1 per 100 runs
• Median command latency: <800ms
• Recovery from crash/disconnect: <10s
• Idempotent resume after failure: yes (always)
If you don’t define this, you can’t engineer toward it.


1) Core architecture (what to build)

A. Control plane (orchestrator)

Responsible for:

• job queue
• per-task state machine
• retries/backoff
• policy checks
• logs/metrics/traces
• secrets access
Tech options:

• Node.js/TypeScript or Python
• Redis + Postgres (queue + durable state)
• Temporal (great for long-running workflows)
B. Browser execution plane (workers)

• Dedicated browser workers (Playwright/Chromium preferred)
• One isolated browser context per task/user
• Sticky session per workflow step
• Health probes + auto-restart
C. State store

• Persist workflow checkpoints:
• current page URL
• selected itinerary details
• completed steps
• pending confirmation steps
• Enables resume after interruption
D. Human approval gateway (critical for payments)

• For risky steps:
• “approve final payment”
• “confirm passenger details”
• One-tap approve/deny with timeout + rollback

2) Why extension relay is flaky (and what to replace)

Extension relays commonly fail due to:

• tab focus changes
• stale element refs
• CDP attachment races
• browser profile/session drift
• anti-bot script timing differences
Better approach

Use managed Playwright workers directly (no extension dependency for core automation), with:

• controlled browser version
• deterministic viewport/user-agent
• robust waits and re-query logic
• self-healing selectors
Use extension relay only as optional/manual mode.


3) Browser automation engineering requirements

A. Deterministic runtime

• Pin browser build version
• Pin Playwright version
• Pin OS image/container
• Disable auto-update during runs
B. Selector strategy

Use layered selectors:

1. stable test ids / ARIA / labels
2. semantic text anchors
3. DOM relation fallbacks
Never rely only on brittle CSS nth-child chains.

C. State synchronization model

For each action:

1. read state snapshot
2. validate expected precondition
3. perform action
4. verify postcondition
5. persist checkpoint
If postcondition fails, do not proceed blindly.

D. Anti-flakiness primitives

• bounded retries with jitter
• stale element re-resolve
• network idle + UI ready checks
• popup/modal watchdog
• auto-dismiss cookie banners/promos
• timeout tiers (short, medium, long actions)

4) Booking-domain workflow requirements

Model booking as a strict finite state machine:

1. Launch / login check
2. Search params input
3. Results loaded verification
4. Sort/filter apply
5. Candidate extraction
6. Fare rule extraction
7. Selection
8. Passenger data validation
9. Ancillaries (bags/seats/meals)
10. Final price reconciliation
11. Human approval gate
12. Payment handoff/submit
13. Confirmation capture + receipt archive
Each state needs:

• entry criteria
• success criteria
• compensating action on failure

5) Data extraction requirements (to avoid “I can’t see it”)

Build parsers that capture:

• flight number
• departure/arrival local time + timezone
• duration + stops
• base fare + fees + ancillaries + total
• fare class / refundability
• baggage allowance
• change/cancel policy
• booking reference at confirmation
Store raw evidence:

• screenshot at each critical step
• HTML snippet or structured scrape
• network response when possible

6) Security requirements (non-negotiable)

A. Secrets

• Use vault/KMS (not env vars in plain text long-term)
• short-lived session tokens where possible
• rotate credentials regularly
B. Payment controls

Bruno The Claw, [2/15/26 4:14 AM]
• Never auto-store CVV
• mandatory human approval for pay click
• transaction limits/policies
• step-up auth support (OTP/2FA pass-through)
C. Isolation

• per-user browser context isolation
• per-task sandbox
• strict outbound allowlist to booking domains
• audit trail immutable logs
D. Compliance

Depending on scale:

• PCI scope awareness (avoid touching card data directly if possible)
• data retention limits for PII/passport data
• encryption at rest + in transit

7) Infrastructure requirements

Compute

• Always-on host(s), low-latency internet
• enough RAM for concurrent browsers (2–4 GB per active worker is safer)
• SSD for traces/screenshots
Network

• stable egress IP(s) (helps account trust)
• geo-consistent routing (avoid suspicious IP hopping)
• DNS reliability + TLS monitoring
High availability

• worker pool with auto-heal
• queue durability
• restart-safe workflow engine
• health checks and circuit breakers

8) Observability requirements

You need full visibility:

• Metrics: attach success, action success, timeouts, retries, run duration
• Logs: structured, per-step correlation ID
• Traces: end-to-end run timeline
• Artifacts: screenshot/video on failure
• Alerting: spike in selector failures, login failures, captcha hits
Without this, you’ll just “feel” flakiness and never fix root causes.


9) Bot-detection / captcha realities

Travel sites can challenge automation.

Requirements:

• human-in-the-loop captcha fallback
• conservative interaction pacing (not robotic spam)
• stable browser fingerprints
• persistent trusted sessions
• legal/TOS review for each target site
No architecture can promise 100% bot-challenge bypass forever.


10) Recommended implementation stack (practical)

Minimal robust stack

• Playwright + Chromium
• Temporal (or durable queue + workflow engine)
• Postgres (state) + Redis (queue/cache)
• OpenTelemetry + Grafana/Loki/Tempo
• Vault/KMS for secrets
• S3-compatible artifact storage (screenshots, traces)
Deployment

• single reliable VM first (simpler)
• then scale to Kubernetes workers if needed

11) Acceptance test suite you should require

Before trusting live bookings, pass:

1. cold start -> search -> shortlist (100 runs)
2. reconnect mid-run (kill browser, resume)
3. popup/cookie/campaign interruptions
4. login expired recovery
5. slow network simulation
6. changed selector scenario
7. final approval gate timeout and rollback
8. receipt extraction and archive validation
Target at least 95% pass on repeated runs before production use.


12) What this means for your exact use case

For “book while I’m away,” you need:

• dedicated always-on automation host
• Playwright worker channel (not extension-only)
• stored trusted sessions for Agoda/Cebu Pacific
• approval step via messaging for final payment
• runbook + alerts + auto-recovery
That gets you from “demo-ish” to “operationally dependable.”


If you want, next message I can give you:

• a concrete phased rollout plan (Week 1 to Week 4),
• plus a reference config for a single-machine “v1 reliable channel.”
