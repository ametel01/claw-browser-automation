import type { Selector } from "../selectors/strategy.js";
import { resolveWithConfidence } from "../selectors/strategy.js";
import type { ActionContext, ActionOptions, ActionResult } from "./action.js";
import { executeAction, resolveTimeout } from "./action.js";

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

export type WaitState = "visible" | "hidden" | "attached" | "detached";

export async function waitForSelector(
	ctx: ActionContext,
	selector: Selector,
	opts: ActionOptions & { state?: WaitState } = {},
): Promise<ActionResult<void>> {
	const timeoutMs = resolveTimeout(opts.timeout);
	const state = opts.state ?? "visible";
	const { actionOpts, selectorInput } = buildSelectorRetryOptions(opts, selector);

	return executeAction(ctx, "waitForSelector", actionOpts, async (_ctx) => {
		recordWait(_ctx, `selector:${state}`);
		const resolution = await resolveWithConfidence(_ctx.page, selectorInput, state, timeoutMs);
		recordSelectorMeta(_ctx, resolution);
		const locator = resolution.locator;
		await locator.first().waitFor({ state, timeout: timeoutMs });
	});
}

export async function waitForCondition(
	ctx: ActionContext,
	condition: string | (() => boolean | Promise<boolean>),
	opts: ActionOptions = {},
): Promise<ActionResult<void>> {
	const timeoutMs = resolveTimeout(opts.timeout);

	return executeAction(ctx, "waitForCondition", opts, async (_ctx) => {
		recordWait(_ctx, "condition");
		await _ctx.page.waitForFunction(condition, { timeout: timeoutMs });
	});
}

export async function waitForNetworkIdle(
	ctx: ActionContext,
	opts: ActionOptions = {},
): Promise<ActionResult<void>> {
	const timeoutMs = resolveTimeout(opts.timeout);

	return executeAction(ctx, "waitForNetworkIdle", opts, async (_ctx) => {
		recordWait(_ctx, "networkidle");
		await _ctx.page.waitForLoadState("networkidle", { timeout: timeoutMs });
	});
}

export async function waitForUrl(
	ctx: ActionContext,
	pattern: string | RegExp,
	opts: ActionOptions = {},
): Promise<ActionResult<string>> {
	const timeoutMs = resolveTimeout(opts.timeout);

	return executeAction(ctx, "waitForUrl", opts, async (_ctx) => {
		recordWait(_ctx, "url");
		await _ctx.page.waitForURL(pattern, { timeout: timeoutMs });
		return _ctx.page.url();
	});
}
