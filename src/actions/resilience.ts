import type { Page } from "playwright-core";
import type { Logger } from "../observe/logger.js";

const DEFAULT_STABILITY_MS = 200;

export async function waitForDomStability(
	page: Page,
	stabilityMs: number = DEFAULT_STABILITY_MS,
	timeoutMs = 5000,
): Promise<void> {
	await page.evaluate(
		({ stabilityMs, timeoutMs }) => {
			return new Promise<void>((resolve, reject) => {
				let timer: ReturnType<typeof setTimeout> | null = null;
				const deadline = setTimeout(() => {
					if (observer) {
						observer.disconnect();
					}
					reject(new Error("dom stability timeout"));
				}, timeoutMs);

				const observer = new MutationObserver(() => {
					if (timer !== null) {
						clearTimeout(timer);
					}
					timer = setTimeout(() => {
						observer.disconnect();
						clearTimeout(deadline);
						resolve();
					}, stabilityMs);
				});

				observer.observe(document.body, {
					childList: true,
					subtree: true,
					attributes: true,
				});

				timer = setTimeout(() => {
					observer.disconnect();
					clearTimeout(deadline);
					resolve();
				}, stabilityMs);
			});
		},
		{ stabilityMs, timeoutMs },
	);
}

const COMMON_POPUP_SELECTORS = [
	// Cookie consent
	'[class*="cookie"] button[class*="accept"]',
	'[class*="cookie"] button[class*="agree"]',
	'[id*="cookie"] button[class*="accept"]',
	'[id*="cookie"] button[class*="agree"]',
	'button[id*="accept-cookies"]',
	'button[id*="cookie-accept"]',
	// GDPR
	'[class*="gdpr"] button[class*="accept"]',
	'[class*="consent"] button[class*="accept"]',
	// Generic close/dismiss
	'[class*="modal"] [class*="close"]',
	'[class*="popup"] [class*="close"]',
	'[class*="overlay"] [class*="close"]',
	'[class*="banner"] [class*="dismiss"]',
	'[class*="banner"] [class*="close"]',
];

export interface PopupDismisserOptions {
	extraSelectors?: string[];
	checkIntervalMs?: number;
}

export class PopupDismisser {
	private _page: Page;
	private _selectors: string[];
	private _intervalMs: number;
	private _timer: ReturnType<typeof setInterval> | null = null;
	private _log: Logger;
	private _dialogHandler: ((dialog: { dismiss: () => Promise<void> }) => void) | null = null;

	constructor(page: Page, logger: Logger, opts: PopupDismisserOptions = {}) {
		this._page = page;
		this._selectors = [...COMMON_POPUP_SELECTORS, ...(opts.extraSelectors ?? [])];
		this._intervalMs = opts.checkIntervalMs ?? 3000;
		this._log = logger.child({ component: "popup-dismisser" });
	}

	start(): void {
		if (this._timer !== null) {
			return;
		}

		this._dialogHandler = (dialog) => {
			this._log.info("auto-dismissing dialog");
			dialog.dismiss().catch(() => {});
		};
		this._page.on("dialog", this._dialogHandler);

		this._timer = setInterval(() => {
			this._sweep().catch((err) => {
				this._log.debug({ err }, "popup sweep error");
			});
		}, this._intervalMs);
	}

	stop(): void {
		if (this._timer !== null) {
			clearInterval(this._timer);
			this._timer = null;
		}
		if (this._dialogHandler) {
			this._page.removeListener("dialog", this._dialogHandler);
			this._dialogHandler = null;
		}
	}

	async dismissOnce(): Promise<number> {
		return this._sweep();
	}

	private async _sweep(): Promise<number> {
		let dismissed = 0;
		for (const selector of this._selectors) {
			try {
				const el = this._page.locator(selector).first();
				if (await el.isVisible({ timeout: 100 })) {
					await el.click({ timeout: 1000 });
					dismissed++;
					this._log.info({ selector }, "dismissed popup element");
				}
			} catch {
				// Element not found or not clickable — expected
			}
		}
		return dismissed;
	}
}
