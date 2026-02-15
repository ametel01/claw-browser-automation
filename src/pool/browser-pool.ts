import type { Browser, LaunchOptions } from "playwright-core";
import { chromium } from "playwright-core";
import type { Logger } from "../observe/logger.js";
import { createLogger } from "../observe/logger.js";
import { BrowserSession } from "../session/session.js";
import type { HealthProbeOptions } from "./health.js";
import { HealthMonitor } from "./health.js";

export interface PoolConfig {
	maxContexts?: number;
	launchOptions?: LaunchOptions;
	healthCheckIntervalMs?: number;
	logger?: Logger;
}

export interface PoolStatus {
	running: boolean;
	activeSessions: number;
	maxContexts: number;
	sessions: Array<{ id: string; url: string; healthy: boolean; profile: string | undefined }>;
}

export interface AcquireOptions {
	profile?: string;
	url?: string;
}

export class BrowserPool {
	private _browser: Browser | null = null;
	private _sessions: Map<string, BrowserSession> = new Map();
	private _health: HealthMonitor;
	private _maxContexts: number;
	private _launchOptions: LaunchOptions;
	private _log: Logger;
	private _launching: Promise<Browser> | null = null;

	constructor(config: PoolConfig = {}) {
		this._maxContexts = config.maxContexts ?? 4;
		this._launchOptions = config.launchOptions ?? {};
		this._log = config.logger ?? createLogger("browser-pool");

		const healthOpts: HealthProbeOptions = {
			onUnhealthy: (session) => this._handleUnhealthy(session),
		};
		if (config.healthCheckIntervalMs !== undefined) {
			healthOpts.intervalMs = config.healthCheckIntervalMs;
		}
		this._health = new HealthMonitor(this._log, healthOpts);
	}

	async acquire(opts: AcquireOptions = {}): Promise<BrowserSession> {
		if (this._sessions.size >= this._maxContexts) {
			throw new Error(
				`pool limit reached: ${this._sessions.size}/${this._maxContexts} contexts in use`,
			);
		}

		const browser = await this._ensureBrowser();
		const context = await browser.newContext();

		// For persistent profiles, we handle state via snapshot restore
		// Playwright's launchPersistentContext is per-browser, not per-context
		// So we use regular contexts + manual cookie/storage restore from profile

		const page = await context.newPage();

		if (opts.url) {
			await page.goto(opts.url, { waitUntil: "domcontentloaded" });
		}

		const session = new BrowserSession({
			context,
			page,
			profile: opts.profile,
			logger: this._log,
		});

		this._sessions.set(session.id, session);
		this._health.track(session);

		this._log.info(
			{ sessionId: session.id, profile: opts.profile, url: opts.url },
			"session acquired",
		);

		return session;
	}

	async release(session: BrowserSession): Promise<void> {
		this._health.untrack(session.id);
		this._sessions.delete(session.id);
		await session.close();
		this._log.info({ sessionId: session.id }, "session released");
	}

	async destroy(sessionId: string): Promise<void> {
		const session = this._sessions.get(sessionId);
		if (!session) {
			this._log.warn({ sessionId }, "destroy called on unknown session");
			return;
		}
		this._health.untrack(sessionId);
		this._sessions.delete(sessionId);
		await session.close();
		this._log.info({ sessionId }, "session destroyed");
	}

	getSession(sessionId: string): BrowserSession | undefined {
		return this._sessions.get(sessionId);
	}

	listSessions(): BrowserSession[] {
		return [...this._sessions.values()];
	}

	status(): PoolStatus {
		return {
			running: this._browser !== null,
			activeSessions: this._sessions.size,
			maxContexts: this._maxContexts,
			sessions: [...this._sessions.values()].map((s) => ({
				id: s.id,
				url: s.currentUrl(),
				healthy: s.isHealthy(),
				profile: s.profile,
			})),
		};
	}

	async shutdown(): Promise<void> {
		this._log.info("shutting down browser pool");
		this._health.stop();

		const closeTasks = [...this._sessions.values()].map((session) =>
			session.close().catch((err) => {
				this._log.warn({ sessionId: session.id, err }, "error closing session during shutdown");
			}),
		);
		await Promise.allSettled(closeTasks);
		this._sessions.clear();

		if (this._browser) {
			try {
				await this._browser.close();
			} catch (err) {
				this._log.warn({ err }, "error closing browser during shutdown");
			}
			this._browser = null;
		}

		this._launching = null;
		this._log.info("browser pool shut down");
	}

	private async _ensureBrowser(): Promise<Browser> {
		if (this._browser?.isConnected()) {
			return this._browser;
		}

		// Prevent concurrent launch attempts
		if (this._launching) {
			return this._launching;
		}

		this._launching = this._launchBrowser();
		try {
			const browser = await this._launching;
			return browser;
		} finally {
			this._launching = null;
		}
	}

	private async _launchBrowser(): Promise<Browser> {
		this._log.info("launching browser");
		const browser = await chromium.launch({
			...this._launchOptions,
			handleSIGINT: false,
			handleSIGTERM: false,
			handleSIGHUP: false,
		});

		browser.on("disconnected", () => {
			this._log.warn("browser disconnected");
			this._browser = null;
			// Mark all sessions unhealthy so next health check triggers recovery
			for (const session of this._sessions.values()) {
				session.markUnhealthy();
			}
		});

		this._browser = browser;
		this._log.info("browser launched");
		return browser;
	}

	private _handleUnhealthy(session: BrowserSession): void {
		this._log.error({ sessionId: session.id }, "session unhealthy — removing from pool");
		this._health.untrack(session.id);
		this._sessions.delete(session.id);
		// Don't await close — it might hang on a dead context
		session.close().catch((err) => {
			this._log.warn({ sessionId: session.id, err }, "error closing unhealthy session");
		});
	}
}
