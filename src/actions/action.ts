import type { Page } from "playwright-core";
import {
	BrowserAutomationError,
	NavigationInterruptedError,
	TargetNotFoundError,
} from "../errors.js";
import type { Logger } from "../observe/logger.js";
import type { ActionTrace, SelectorResolutionTrace } from "../observe/trace.js";
import { PopupDismisser } from "./resilience.js";

export interface StructuredError {
	code: string;
	message: string;
	recoveryHint: string;
}

export interface ActionResult<T = unknown> {
	ok: boolean;
	data?: T;
	error?: string;
	structuredError?: StructuredError;
	retries: number;
	durationMs: number;
	screenshot?: string;
}

export function toStructuredError(err: unknown): string | StructuredError {
	if (err instanceof BrowserAutomationError) {
		return { code: err.code, message: err.message, recoveryHint: err.recoveryHint };
	}
	if (err instanceof Error) {
		return err.message;
	}
	return String(err);
}

export type TimeoutTier = "short" | "medium" | "long";

const TIMEOUT_VALUES: Record<TimeoutTier, number> = {
	short: 5_000,
	medium: 15_000,
	long: 45_000,
};

export function resolveTimeout(timeout: TimeoutTier | number | undefined): number {
	if (timeout === undefined) {
		return TIMEOUT_VALUES.medium;
	}
	if (typeof timeout === "number") {
		return timeout;
	}
	return TIMEOUT_VALUES[timeout];
}

export interface TraceMetadata {
	selectorResolved?: SelectorResolutionTrace;
	eventsDispatched?: string[];
	waitsPerformed?: string[];
	assertionsChecked?: string[];
}

export interface ActionContext {
	page: Page;
	logger: Logger;
	screenshotDir?: string;
	sessionId?: string;
	trace?: ActionTrace;
	_traceMeta?: TraceMetadata;
	_retryState?: RetryState;
}

export interface RetryState {
	lastClickSelector?: string;
	lastClickTime?: number;
}

export interface ActionOptions {
	timeout?: TimeoutTier | number;
	retries?: number;
	screenshotOnFailure?: boolean;
	precondition?: (ctx: ActionContext) => Promise<boolean>;
	postcondition?: (ctx: ActionContext) => Promise<boolean>;
	/** Internal: mutable array of selector strategies for rotation on retry. */
	_selectorStrategies?: unknown[];
}

const DEFAULT_RETRIES = 3;

type AttemptOutcome<T> = { tag: "success"; data: T } | { tag: "retry"; error: string };

async function runAttempt<T>(
	ctx: ActionContext,
	opts: ActionOptions,
	fn: (ctx: ActionContext, timeoutMs: number) => Promise<T>,
	timeoutMs: number,
): Promise<AttemptOutcome<T>> {
	if (opts.precondition && !(await opts.precondition(ctx))) {
		return { tag: "retry", error: "precondition failed" };
	}

	const data = await fn(ctx, timeoutMs);

	if (opts.postcondition && !(await opts.postcondition(ctx))) {
		return { tag: "retry", error: "postcondition failed" };
	}

	return { tag: "success", data };
}

type RetryLoopResult<T> =
	| { tag: "success"; data: T; attempt: number }
	| { tag: "exhausted"; lastError: string; lastCaughtError: unknown };

async function retryLoop<T>(
	ctx: ActionContext,
	name: string,
	opts: ActionOptions,
	fn: (ctx: ActionContext, timeoutMs: number) => Promise<T>,
	timeoutMs: number,
	maxRetries: number,
	startUrl: string,
	popupDismisser: PopupDismisser,
): Promise<RetryLoopResult<T>> {
	let lastError = "";
	let lastCaughtError: unknown;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		lastCaughtError = undefined;

		const navCheck = checkNavigationGuard(attempt, ctx, startUrl);
		if (navCheck) {
			return { tag: "exhausted", lastError: navCheck.message, lastCaughtError: navCheck };
		}

		try {
			await popupDismisser.dismissOnce();
			const outcome = await runAttempt(ctx, opts, fn, timeoutMs);
			if (outcome.tag === "success") {
				return { tag: "success", data: outcome.data, attempt };
			}
			lastError = outcome.error;
			ctx.logger.warn({ action: name, attempt }, lastError);
		} catch (err) {
			lastCaughtError = err;
			lastError = err instanceof Error ? err.message : String(err);
			ctx.logger.warn({ action: name, attempt, error: lastError }, "action attempt failed");
			handleRetryError(err, opts, ctx, name);
		}

		if (attempt < maxRetries) {
			await backoff(attempt);
		}
	}

	return { tag: "exhausted", lastError, lastCaughtError };
}

function checkNavigationGuard(
	attempt: number,
	ctx: ActionContext,
	startUrl: string,
): NavigationInterruptedError | undefined {
	if (attempt === 0) {
		return undefined;
	}
	const currentUrl = ctx.page.url();
	if (currentUrl !== startUrl) {
		return new NavigationInterruptedError(
			`page navigated from ${startUrl} to ${currentUrl} during retry`,
		);
	}
	return undefined;
}

function handleRetryError(
	err: unknown,
	opts: ActionOptions,
	ctx: ActionContext,
	name: string,
): void {
	if (err instanceof TargetNotFoundError && opts._selectorStrategies) {
		rotateStrategies(opts._selectorStrategies);
		ctx.logger.debug({ action: name }, "rotated selector strategies for retry");
	}
}

function rotateStrategies(strategies: unknown[]): void {
	if (strategies.length <= 1) {
		return;
	}
	const first = strategies.shift();
	if (first !== undefined) {
		strategies.push(first);
	}
}

export async function executeAction<T>(
	ctx: ActionContext,
	name: string,
	opts: ActionOptions,
	fn: (ctx: ActionContext, timeoutMs: number) => Promise<T>,
): Promise<ActionResult<T>> {
	const maxRetries = opts.retries ?? DEFAULT_RETRIES;
	const timeoutMs = resolveTimeout(opts.timeout);
	const startedAt = performance.now();
	const popupDismisser = new PopupDismisser(ctx.page, ctx.logger);
	popupDismisser.start();

	ctx._traceMeta = {};
	ctx._retryState = {};
	const startUrl = ctx.page.url();

	try {
		const loopResult = await retryLoop(
			ctx,
			name,
			opts,
			fn,
			timeoutMs,
			maxRetries,
			startUrl,
			popupDismisser,
		);

		if (loopResult.tag === "success") {
			const durationMs = Math.round(performance.now() - startedAt);
			recordTraceEntry(ctx, name, {
				timestamp: Date.now(),
				durationMs,
				ok: true,
				retries: loopResult.attempt,
			});
			return { ok: true, data: loopResult.data, retries: loopResult.attempt, durationMs };
		}

		return buildFailureResult(
			ctx,
			name,
			loopResult.lastError,
			loopResult.lastCaughtError,
			maxRetries,
			startedAt,
			opts,
		);
	} finally {
		popupDismisser.stop();
	}
}

async function buildFailureResult<T>(
	ctx: ActionContext,
	name: string,
	lastError: string,
	lastCaughtError: unknown,
	maxRetries: number,
	startedAt: number,
	opts: ActionOptions,
): Promise<ActionResult<T>> {
	const structured = toStructuredError(lastCaughtError ?? lastError);
	const result: ActionResult<T> = {
		ok: false,
		error: lastError,
		retries: maxRetries,
		durationMs: Math.round(performance.now() - startedAt),
	};
	if (typeof structured === "object") {
		result.structuredError = structured;
	}

	if (opts.screenshotOnFailure !== false) {
		try {
			const screenshotPath = await captureFailureScreenshot(ctx, name);
			if (screenshotPath) {
				result.screenshot = screenshotPath;
			}
		} catch {
			ctx.logger.debug("failed to capture failure screenshot");
		}
	}

	ctx.logger.error({ action: name, error: lastError, retries: maxRetries }, "action failed");
	recordTraceEntry(ctx, name, {
		timestamp: Date.now(),
		durationMs: result.durationMs,
		ok: false,
		...(result.error ? { error: result.error } : {}),
		retries: result.retries,
	});
	return result;
}

function recordTraceEntry(
	ctx: ActionContext,
	action: string,
	entry: {
		timestamp: number;
		durationMs: number;
		ok: boolean;
		error?: string;
		retries: number;
	},
): void {
	if (!(ctx.trace && ctx.sessionId)) {
		return;
	}
	const meta = ctx._traceMeta;
	ctx.trace.record(ctx.sessionId, {
		action,
		timestamp: entry.timestamp,
		durationMs: entry.durationMs,
		ok: entry.ok,
		...(entry.error ? { error: entry.error } : {}),
		retries: entry.retries,
		...(meta?.selectorResolved ? { selectorResolved: meta.selectorResolved } : {}),
		...(meta?.eventsDispatched?.length ? { eventsDispatched: meta.eventsDispatched } : {}),
		...(meta?.waitsPerformed?.length ? { waitsPerformed: meta.waitsPerformed } : {}),
		...(meta?.assertionsChecked?.length ? { assertionsChecked: meta.assertionsChecked } : {}),
	});
}

async function backoff(attempt: number): Promise<void> {
	const base = Math.min(100 * 2 ** attempt, 2000);
	const jitter = Math.floor(Math.random() * 500);
	await new Promise<void>((resolve) => {
		setTimeout(resolve, base + jitter);
	});
}

async function captureFailureScreenshot(
	ctx: ActionContext,
	actionName: string,
): Promise<string | undefined> {
	if (!ctx.screenshotDir) {
		return undefined;
	}
	const { mkdirSync, writeFileSync } = await import("node:fs");
	const { join } = await import("node:path");

	mkdirSync(ctx.screenshotDir, { recursive: true });
	const filename = `${Date.now()}-${actionName}-failure.png`;
	const filepath = join(ctx.screenshotDir, filename);
	const buffer = await ctx.page.screenshot();
	writeFileSync(filepath, buffer);
	return filepath;
}
