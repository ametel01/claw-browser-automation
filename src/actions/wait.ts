import type { Selector } from "../selectors/strategy.js";
import { resolveWithConfidence } from "../selectors/strategy.js";
import type { ActionContext, ActionOptions, ActionResult } from "./action.js";
import { executeAction, resolveTimeout } from "./action.js";

export type WaitState = "visible" | "hidden" | "attached" | "detached";

export async function waitForSelector(
	ctx: ActionContext,
	selector: Selector,
	opts: ActionOptions & { state?: WaitState } = {},
): Promise<ActionResult<void>> {
	const timeoutMs = resolveTimeout(opts.timeout);
	const state = opts.state ?? "visible";

	return executeAction(ctx, "waitForSelector", opts, async (_ctx) => {
		const resolution = await resolveWithConfidence(_ctx.page, selector, state, timeoutMs);
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
		await _ctx.page.waitForFunction(condition, { timeout: timeoutMs });
	});
}

export async function waitForNetworkIdle(
	ctx: ActionContext,
	opts: ActionOptions = {},
): Promise<ActionResult<void>> {
	const timeoutMs = resolveTimeout(opts.timeout);

	return executeAction(ctx, "waitForNetworkIdle", opts, async (_ctx) => {
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
		await _ctx.page.waitForURL(pattern, { timeout: timeoutMs });
		return _ctx.page.url();
	});
}
