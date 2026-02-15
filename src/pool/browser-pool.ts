import type { Browser, LaunchOptions } from "playwright-core";
import { chromium } from "playwright-core";
import type { Logger } from "../observe/logger.js";
import { createLogger } from "../observe/logger.js";
import { ensureProfileDir, loadProfileSnapshot, saveProfileSnapshot } from "../session/profiles.js";
import { BrowserSession } from "../session/session.js";
import type { SessionSnapshot } from "../session/snapshot.js";
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
	private _shuttingDown = false;

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

		let profileSnapshot: SessionSnapshot | undefined;
		if (opts.profile) {
			ensureProfileDir(opts.profile);
			profileSnapshot = loadProfileSnapshot(opts.profile);
		}

		const browser = await this._ensureBrowser();
		const context = await browser.newContext();
		const page = await context.newPage();
		const session = new BrowserSession({
			context,
			page,
			profile: opts.profile,
			logger: this._log,
		});

		if (profileSnapshot) {
			await session.restore(profileSnapshot);
		}
		if (opts.url) {
			await page.goto(opts.url, { waitUntil: "domcontentloaded" });
		}

		this._sessions.set(session.id, session);
		this._health.track(session);

		this._log.info(
			{ sessionId: session.id, profile: opts.profile, url: opts.url },
			"session acquired",
		);

		return session;
	}

	async release(session: BrowserSession): Promise<void> {
		await this._persistProfileSnapshot(session);
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
		await this._persistProfileSnapshot(session);
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
		this._shuttingDown = true;
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
		this._shuttingDown = false;
		this._log.info("browser pool shut down");
	}

	private async _ensureBrowser(): Promise<Browser> {
		if (this._browser?.isConnected()) {
			return this._browser;
		}

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
			for (const session of this._sessions.values()) {
				session.markUnhealthy();
				this._handleUnhealthy(session);
			}
		});

		this._browser = browser;
		this._log.info("browser launched");
		return browser;
	}

	private async _persistProfileSnapshot(session: BrowserSession): Promise<void> {
		if (!session.profile) {
			return;
		}
		try {
			const snapshot = await session.snapshot();
			saveProfileSnapshot(session.profile, snapshot);
		} catch (err) {
			this._log.warn(
				{ sessionId: session.id, profile: session.profile, err },
				"failed to persist profile snapshot",
			);
		}
	}

	private _handleUnhealthy(session: BrowserSession): void {
		this._recoverUnhealthy(session).catch((err) => {
			this._log.error({ sessionId: session.id, err }, "unhealthy session recovery failed");
		});
	}

	private async _recoverUnhealthy(session: BrowserSession): Promise<void> {
		if (this._shuttingDown) {
			return;
		}
		if (!this._sessions.has(session.id)) {
			return;
		}

		this._log.error({ sessionId: session.id }, "session unhealthy — recreating context");
		let snapshot: SessionSnapshot | undefined;
		try {
			snapshot = await session.snapshot();
		} catch {
			if (session.profile) {
				snapshot = loadProfileSnapshot(session.profile);
			}
		}

		this._health.untrack(session.id);
		this._sessions.delete(session.id);
		try {
			await session.close();
		} catch (err) {
			this._log.warn({ sessionId: session.id, err }, "error closing unhealthy session");
		}

		try {
			const browser = await this._ensureBrowser();
			const context = await browser.newContext();
			const page = await context.newPage();
			const replacement = new BrowserSession({
				context,
				page,
				profile: session.profile,
				logger: this._log,
			});

			if (snapshot) {
				await replacement.restore(snapshot);
			}

			this._sessions.set(replacement.id, replacement);
			this._health.track(replacement);
			this._log.info(
				{ oldSessionId: session.id, sessionId: replacement.id },
				"unhealthy session recovered",
			);
		} catch (err) {
			this._log.error({ sessionId: session.id, err }, "failed to recover unhealthy session");
		}
	}
}
