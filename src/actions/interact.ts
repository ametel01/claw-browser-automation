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

export type InputMode = "fill" | "sequential" | "paste" | "nativeSetter";

export interface TypeOptions extends ActionOptions {
	clear?: boolean;
	/** Use sequential key presses instead of programmatic fill.
	 *  Essential for autocomplete/combobox inputs that rely on per-keystroke events.
	 *  @deprecated Use `mode: "sequential"` instead. */
	sequential?: boolean;
	/** Delay between key presses in ms when sequential is true. Default: 80 */
	delayMs?: number;
	/** Input mode strategy. Takes precedence over `sequential` when set.
	 *  - "fill" (default): Playwright `locator.fill()` with verification
	 *  - "sequential": `locator.pressSequentially()` for per-keystroke events
	 *  - "paste": Dispatch ClipboardEvent with DataTransfer (bypasses key event handlers)
	 *  - "nativeSetter": Use HTMLInputElement.prototype.value setter + input/change/blur events
	 *    (for React/Vue controlled inputs) */
	mode?: InputMode;
}

function resolveInputMode(opts: TypeOptions): InputMode {
	if (opts.mode) {
		return opts.mode;
	}
	if (opts.sequential) {
		return "sequential";
	}
	return "fill";
}

export async function type(
	ctx: ActionContext,
	selector: Selector,
	text: string,
	opts: TypeOptions = {},
): Promise<ActionResult<void>> {
	const timeoutMs = resolveTimeout(opts.timeout);
	const { actionOpts, selectorInput } = buildSelectorRetryOptions(opts, selector);
	const mode = resolveInputMode(opts);
	return executeAction(ctx, "type", actionOpts, async (_ctx) => {
		recordWait(_ctx, "domStability");
		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));
		const resolution = await resolveWithConfidence(_ctx.page, selectorInput, "visible", timeoutMs);
		recordSelectorMeta(_ctx, resolution);
		const locator = resolution.locator.first();
		if (opts.clear !== false) {
			await locator.clear({ timeout: timeoutMs });
		}
		await applyInputMode(_ctx, locator, text, mode, timeoutMs, opts.delayMs);
	});
}

async function applyInputMode(
	ctx: ActionContext,
	locator: Awaited<ReturnType<typeof resolveFirstVisible>>,
	text: string,
	mode: InputMode,
	timeoutMs: number,
	delayMs?: number,
): Promise<void> {
	switch (mode) {
		case "sequential": {
			const delay = delayMs ?? 80;
			await locator.pressSequentially(text, { delay, timeout: timeoutMs });
			recordEvent(ctx, "typeSequential");
			break;
		}
		case "paste": {
			await locator.evaluate((el, value) => {
				const input = el as HTMLInputElement;
				input.focus();
				const dt = new DataTransfer();
				dt.setData("text/plain", value);
				const event = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true });
				input.dispatchEvent(event);
				// Fallback: if paste didn't populate the value, set directly
				if (input.value !== value) {
					input.value = value;
					input.dispatchEvent(new Event("input", { bubbles: true }));
					input.dispatchEvent(new Event("change", { bubbles: true }));
				}
			}, text);
			recordEvent(ctx, "paste");
			break;
		}
		case "nativeSetter": {
			await locator.evaluate((el, value) => {
				const input = el as HTMLInputElement;
				input.focus();
				const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
				if (setter) {
					setter.call(input, value);
				} else {
					input.value = value;
				}
				input.dispatchEvent(new Event("input", { bubbles: true }));
				input.dispatchEvent(new Event("change", { bubbles: true }));
				input.dispatchEvent(new Event("blur", { bubbles: true }));
			}, text);
			recordEvent(ctx, "nativeSetter");
			break;
		}
		default: {
			// "fill" mode
			await locator.fill(text, { timeout: timeoutMs });
			recordEvent(ctx, "fill");
			const value = await locator.inputValue({ timeout: timeoutMs });
			if (value !== text) {
				throw new AssertionFailedError(
					`type verification failed: expected "${text}", got "${value}"`,
				);
			}
			break;
		}
	}
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
