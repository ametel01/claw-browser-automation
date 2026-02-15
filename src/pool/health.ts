import type { Logger } from "../observe/logger.js";
import type { BrowserSession } from "../session/session.js";

const HEALTH_CHECK_INTERVAL_MS = 30_000;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;
const MAX_CONSECUTIVE_FAILURES = 3;

export interface HealthProbeOptions {
	intervalMs?: number;
	timeoutMs?: number;
	maxFailures?: number;
	onUnhealthy: (session: BrowserSession) => void;
}

interface TrackedSession {
	session: BrowserSession;
	consecutiveFailures: number;
}

export class HealthMonitor {
	private _tracked: Map<string, TrackedSession> = new Map();
	private _timer: ReturnType<typeof setInterval> | null = null;
	private _intervalMs: number;
	private _timeoutMs: number;
	private _maxFailures: number;
	private _onUnhealthy: (session: BrowserSession) => void;
	private _log: Logger;

	constructor(logger: Logger, opts: HealthProbeOptions) {
		this._intervalMs = opts.intervalMs ?? HEALTH_CHECK_INTERVAL_MS;
		this._timeoutMs = opts.timeoutMs ?? HEALTH_CHECK_TIMEOUT_MS;
		this._maxFailures = opts.maxFailures ?? MAX_CONSECUTIVE_FAILURES;
		this._onUnhealthy = opts.onUnhealthy;
		this._log = logger.child({ component: "health" });
	}

	track(session: BrowserSession): void {
		this._tracked.set(session.id, { session, consecutiveFailures: 0 });
		this._ensureRunning();
	}

	untrack(sessionId: string): void {
		this._tracked.delete(sessionId);
		if (this._tracked.size === 0) {
			this._stop();
		}
	}

	async checkOne(sessionId: string): Promise<boolean> {
		const tracked = this._tracked.get(sessionId);
		if (!tracked) {
			return false;
		}
		return this._probe(tracked);
	}

	stop(): void {
		this._stop();
		this._tracked.clear();
	}

	private _ensureRunning(): void {
		if (this._timer !== null) {
			return;
		}
		this._timer = setInterval(() => {
			this._checkAll().catch((err) => {
				this._log.error({ err }, "health check cycle failed");
			});
		}, this._intervalMs);
	}

	private _stop(): void {
		if (this._timer !== null) {
			clearInterval(this._timer);
			this._timer = null;
		}
	}

	private async _checkAll(): Promise<void> {
		const checks = [...this._tracked.values()].map((tracked) => this._probe(tracked));
		await Promise.allSettled(checks);
	}

	private async _probe(tracked: TrackedSession): Promise<boolean> {
		const { session } = tracked;

		if (!session.isHealthy()) {
			return false;
		}

		try {
			const result = await Promise.race([
				session.page.evaluate(() => document.readyState),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error("health check timeout")), this._timeoutMs),
				),
			]);
			if (result === "complete" || result === "interactive" || result === "loading") {
				tracked.consecutiveFailures = 0;
				return true;
			}
			return this._recordFailure(tracked, "unexpected readyState");
		} catch (err) {
			const message = err instanceof Error ? err.message : "unknown error";
			return this._recordFailure(tracked, message);
		}
	}

	private _recordFailure(tracked: TrackedSession, reason: string): boolean {
		tracked.consecutiveFailures++;
		this._log.warn(
			{
				sessionId: tracked.session.id,
				failures: tracked.consecutiveFailures,
				reason,
			},
			"health check failed",
		);

		if (tracked.consecutiveFailures >= this._maxFailures) {
			this._log.error(
				{ sessionId: tracked.session.id },
				`${this._maxFailures} consecutive failures — marking unhealthy`,
			);
			tracked.session.markUnhealthy();
			this._onUnhealthy(tracked.session);
		}

		return false;
	}
}
