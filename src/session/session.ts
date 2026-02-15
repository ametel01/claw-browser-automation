import { nanoid } from "nanoid";
import type { BrowserContext, Page } from "playwright-core";
import type { Logger } from "../observe/logger.js";
import type { CookieData, SessionSnapshot } from "./snapshot.js";

export interface BrowserSessionOptions {
	context: BrowserContext;
	page: Page;
	profile: string | undefined;
	logger: Logger;
}

export class BrowserSession {
	readonly id: string;
	private _page: Page;
	private _context: BrowserContext;
	private _profile: string | undefined;
	private _healthy: boolean;
	private _log: Logger;

	constructor(opts: BrowserSessionOptions) {
		this.id = nanoid(12);
		this._page = opts.page;
		this._context = opts.context;
		this._profile = opts.profile;
		this._healthy = true;
		this._log = opts.logger.child({ sessionId: this.id });

		this._setupListeners();
	}

	get page(): Page {
		return this._page;
	}

	get context(): BrowserContext {
		return this._context;
	}

	get profile(): string | undefined {
		return this._profile;
	}

	currentUrl(): string {
		return this._page.url();
	}

	isHealthy(): boolean {
		return this._healthy;
	}

	markUnhealthy(): void {
		this._healthy = false;
		this._log.warn("session marked unhealthy");
	}

	markHealthy(): void {
		this._healthy = true;
	}

	async snapshot(): Promise<SessionSnapshot> {
		const cookies = await this._context.cookies();
		const url = this._page.url();

		let localStorage: Record<string, string> = {};
		try {
			localStorage = await this._page.evaluate(() => {
				const entries: Record<string, string> = {};
				for (let i = 0; i < window.localStorage.length; i++) {
					const key = window.localStorage.key(i);
					if (key !== null) {
						const value = window.localStorage.getItem(key);
						if (value !== null) {
							entries[key] = value;
						}
					}
				}
				return entries;
			});
		} catch {
			this._log.warn("failed to capture localStorage (page may be on about:blank)");
		}

		return {
			sessionId: this.id,
			url,
			cookies: cookies.map(
				(c): CookieData => ({
					name: c.name,
					value: c.value,
					domain: c.domain,
					path: c.path,
					expires: c.expires,
					httpOnly: c.httpOnly,
					secure: c.secure,
					sameSite: c.sameSite,
				}),
			),
			localStorage,
			timestamp: Date.now(),
		};
	}

	async restore(snapshot: SessionSnapshot): Promise<void> {
		const cookiePayload = snapshot.cookies.map((cookie) => ({
			name: cookie.name,
			value: cookie.value,
			domain: cookie.domain,
			path: cookie.path,
			expires: cookie.expires,
			httpOnly: cookie.httpOnly,
			secure: cookie.secure,
			sameSite: cookie.sameSite,
		}));
		await this._context.clearCookies();
		if (cookiePayload.length > 0) {
			await this._context.addCookies(cookiePayload);
		}

		if (this._page.isClosed()) {
			this._page = await this._context.newPage();
			this._setupListeners();
		}

		if (snapshot.url) {
			await this._page.goto(snapshot.url, { waitUntil: "domcontentloaded" });
		}

		if (Object.keys(snapshot.localStorage).length > 0) {
			try {
				await this._page.evaluate((entries) => {
					for (const [key, value] of Object.entries(entries)) {
						window.localStorage.setItem(key, value);
					}
				}, snapshot.localStorage);
			} catch {
				this._log.warn("failed to restore localStorage for snapshot");
			}
		}

		this.markHealthy();
	}

	async newPage(url?: string): Promise<Page> {
		const page = await this._context.newPage();
		if (url) {
			await page.goto(url, { waitUntil: "domcontentloaded" });
		}
		this._page = page;
		this._setupListeners();
		return page;
	}

	async close(): Promise<void> {
		this._log.info("closing session");
		try {
			await this._context.close();
		} catch (err) {
			this._log.warn({ err }, "error closing context");
		}
		this._healthy = false;
	}

	private _setupListeners(): void {
		this._page.on("crash", () => {
			this._log.error("page crashed");
			this._healthy = false;
		});

		this._page.on("close", () => {
			this._log.debug("page closed");
		});
	}
}
