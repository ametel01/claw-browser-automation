import { AssertionFailedError } from "../errors.js";
import type { Selector } from "../selectors/strategy.js";
import { resolveFirstVisible, resolveWithConfidence } from "../selectors/strategy.js";
import type { ActionContext, ActionOptions, ActionResult } from "./action.js";
import { executeAction, resolveTimeout } from "./action.js";
import { waitForDomStability } from "./resilience.js";

const DEDUP_CLICK_MS = 500;

function buildSelectorRetryOptions(
	opts: ActionOptions,
	selector: Selector,
): { actionOpts: ActionOptions; selectorInput: Selector } {
	if (!Array.isArray(selector)) {
		return { actionOpts: opts, selectorInput: selector };
	}
	const selectorStrategies = [...selector];
	return {
		actionOpts: {
			...opts,
			_selectorStrategies: selectorStrategies,
		},
		selectorInput: selectorStrategies,
	};
}

function recordSelectorMeta(
	ctx: ActionContext,
	resolution: { strategy: { type: string }; strategyIndex: number; resolutionMs: number },
): void {
	if (!ctx._traceMeta) {
		ctx._traceMeta = {};
	}
	ctx._traceMeta.selectorResolved = {
		strategy: resolution.strategy.type,
		strategyIndex: resolution.strategyIndex,
		resolutionMs: resolution.resolutionMs,
	};
}

function recordWait(ctx: ActionContext, waitType: string): void {
	if (!ctx._traceMeta) {
		ctx._traceMeta = {};
	}
	if (!ctx._traceMeta.waitsPerformed) {
		ctx._traceMeta.waitsPerformed = [];
	}
	ctx._traceMeta.waitsPerformed.push(waitType);
}

function recordEvent(ctx: ActionContext, eventName: string): void {
	if (!ctx._traceMeta) {
		ctx._traceMeta = {};
	}
	if (!ctx._traceMeta.eventsDispatched) {
		ctx._traceMeta.eventsDispatched = [];
	}
	ctx._traceMeta.eventsDispatched.push(eventName);
}

export async function click(
	ctx: ActionContext,
	selector: Selector,
	opts: ActionOptions = {},
): Promise<ActionResult<void>> {
	const timeoutMs = resolveTimeout(opts.timeout);
	const { actionOpts, selectorInput } = buildSelectorRetryOptions(opts, selector);
	const selectorKey = typeof selector === "string" ? selector : JSON.stringify(selector);
	return executeAction(ctx, "click", actionOpts, async (_ctx) => {
		// Duplicate click prevention
		const retryState = _ctx._retryState;
		if (retryState?.lastClickSelector === selectorKey && retryState.lastClickTime) {
			const elapsed = Date.now() - retryState.lastClickTime;
			if (elapsed < DEDUP_CLICK_MS) {
				_ctx.logger.debug({ selector: selectorKey, elapsed }, "skipping duplicate click");
				return;
			}
		}

		recordWait(_ctx, "domStability");
		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));
		const resolution = await resolveWithConfidence(_ctx.page, selectorInput, "visible", timeoutMs);
		recordSelectorMeta(_ctx, resolution);
		const locator = resolution.locator.first();
		await locator.scrollIntoViewIfNeeded({ timeout: timeoutMs });
		await locator.click({ timeout: timeoutMs });
		recordEvent(_ctx, "click");
		recordWait(_ctx, "domStability");
		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));

		// Track for dedup
		if (!_ctx._retryState) {
			_ctx._retryState = {};
		}
		_ctx._retryState.lastClickSelector = selectorKey;
		_ctx._retryState.lastClickTime = Date.now();
	});
}

export interface TypeOptions extends ActionOptions {
	clear?: boolean;
	/** Use sequential key presses instead of programmatic fill.
	 *  Essential for autocomplete/combobox inputs that rely on per-keystroke events. */
	sequential?: boolean;
	/** Delay between key presses in ms when sequential is true. Default: 80 */
	delayMs?: number;
}

export async function type(
	ctx: ActionContext,
	selector: Selector,
	text: string,
	opts: TypeOptions = {},
): Promise<ActionResult<void>> {
	const timeoutMs = resolveTimeout(opts.timeout);
	const { actionOpts, selectorInput } = buildSelectorRetryOptions(opts, selector);
	return executeAction(ctx, "type", actionOpts, async (_ctx) => {
		recordWait(_ctx, "domStability");
		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));
		const resolution = await resolveWithConfidence(_ctx.page, selectorInput, "visible", timeoutMs);
		recordSelectorMeta(_ctx, resolution);
		const locator = resolution.locator.first();
		if (opts.clear !== false) {
			await locator.clear({ timeout: timeoutMs });
		}
		if (opts.sequential) {
			const delay = opts.delayMs ?? 80;
			await locator.pressSequentially(text, { delay, timeout: timeoutMs });
			recordEvent(_ctx, "typeSequential");
		} else {
			await locator.fill(text, { timeout: timeoutMs });
			recordEvent(_ctx, "fill");
			const value = await locator.inputValue({ timeout: timeoutMs });
			if (value !== text) {
				throw new AssertionFailedError(
					`type verification failed: expected "${text}", got "${value}"`,
				);
			}
		}
	});
}

export async function selectOption(
	ctx: ActionContext,
	selector: Selector,
	value: string | string[],
	opts: ActionOptions = {},
): Promise<ActionResult<string[]>> {
	const timeoutMs = resolveTimeout(opts.timeout);
	const { actionOpts, selectorInput } = buildSelectorRetryOptions(opts, selector);
	return executeAction(ctx, "selectOption", actionOpts, async (_ctx) => {
		recordWait(_ctx, "domStability");
		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));
		const resolution = await resolveWithConfidence(_ctx.page, selectorInput, "visible", timeoutMs);
		recordSelectorMeta(_ctx, resolution);
		const locator = resolution.locator.first();
		const selected = await locator.selectOption(value, { timeout: timeoutMs });
		recordEvent(_ctx, "selectOption");
		const expected = Array.isArray(value) ? value : [value];
		for (const entry of expected) {
			if (!selected.includes(entry)) {
				throw new AssertionFailedError(`select verification failed: "${entry}" was not selected`);
			}
		}
		return selected;
	});
}

export async function check(
	ctx: ActionContext,
	selector: Selector,
	opts: ActionOptions = {},
): Promise<ActionResult<void>> {
	const timeoutMs = resolveTimeout(opts.timeout);
	const { actionOpts, selectorInput } = buildSelectorRetryOptions(opts, selector);
	return executeAction(ctx, "check", actionOpts, async (_ctx) => {
		const resolution = await resolveWithConfidence(_ctx.page, selectorInput, "visible", timeoutMs);
		recordSelectorMeta(_ctx, resolution);
		const locator = resolution.locator.first();
		await locator.check({ timeout: timeoutMs });
		recordEvent(_ctx, "check");
		if (!(await locator.isChecked({ timeout: timeoutMs }))) {
			throw new AssertionFailedError("check verification failed");
		}
	});
}

export async function uncheck(
	ctx: ActionContext,
	selector: Selector,
	opts: ActionOptions = {},
): Promise<ActionResult<void>> {
	const timeoutMs = resolveTimeout(opts.timeout);
	const { actionOpts, selectorInput } = buildSelectorRetryOptions(opts, selector);
	return executeAction(ctx, "uncheck", actionOpts, async (_ctx) => {
		const resolution = await resolveWithConfidence(_ctx.page, selectorInput, "visible", timeoutMs);
		recordSelectorMeta(_ctx, resolution);
		const locator = resolution.locator.first();
		await locator.uncheck({ timeout: timeoutMs });
		recordEvent(_ctx, "uncheck");
		if (await locator.isChecked({ timeout: timeoutMs })) {
			throw new AssertionFailedError("uncheck verification failed");
		}
	});
}

export async function hover(
	ctx: ActionContext,
	selector: Selector,
	opts: ActionOptions = {},
): Promise<ActionResult<void>> {
	const timeoutMs = resolveTimeout(opts.timeout);
	const { actionOpts, selectorInput } = buildSelectorRetryOptions(opts, selector);
	return executeAction(ctx, "hover", actionOpts, async (_ctx) => {
		recordWait(_ctx, "domStability");
		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));
		const resolution = await resolveWithConfidence(_ctx.page, selectorInput, "visible", timeoutMs);
		recordSelectorMeta(_ctx, resolution);
		const locator = resolution.locator.first();
		await locator.hover({ timeout: timeoutMs });
		recordEvent(_ctx, "hover");
	});
}

export async function dragAndDrop(
	ctx: ActionContext,
	source: Selector,
	target: Selector,
	opts: ActionOptions = {},
): Promise<ActionResult<void>> {
	const timeoutMs = resolveTimeout(opts.timeout);
	return executeAction(ctx, "dragAndDrop", opts, async (_ctx) => {
		recordWait(_ctx, "domStability");
		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));
		const sourceLocator = await resolveFirstVisible(_ctx.page, source, timeoutMs);
		const targetLocator = await resolveFirstVisible(_ctx.page, target, timeoutMs);
		await sourceLocator.dragTo(targetLocator, { timeout: timeoutMs });
		recordEvent(_ctx, "dragAndDrop");
		recordWait(_ctx, "domStability");
		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));
	});
}

export interface FillFieldsResult {
	filled: string[];
	failed: string[];
}

export async function fill(
	ctx: ActionContext,
	fields: Record<string, string>,
	opts: ActionOptions = {},
): Promise<ActionResult<FillFieldsResult>> {
	const timeoutMs = resolveTimeout(opts.timeout);
	return executeAction(ctx, "fill", opts, async (_ctx) => {
		recordWait(_ctx, "domStability");
		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));
		const filled: string[] = [];
		const failed: string[] = [];

		for (const [selectorStr, value] of Object.entries(fields)) {
			try {
				const locator = await resolveFirstVisible(_ctx.page, selectorStr, timeoutMs);
				await locator.clear({ timeout: timeoutMs });
				await locator.fill(value, { timeout: timeoutMs });
				recordEvent(_ctx, "fill");
				const actual = await locator.inputValue({ timeout: timeoutMs });
				if (actual !== value) {
					throw new AssertionFailedError(`fill verification failed for ${selectorStr}`);
				}
				filled.push(selectorStr);
			} catch {
				failed.push(selectorStr);
			}
		}

		if (failed.length > 0) {
			throw new Error(`failed to fill fields: ${failed.join(", ")}`);
		}

		return { filled, failed };
	});
}
