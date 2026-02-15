import type { ActionContext, ActionOptions, ActionResult } from "./action.js";
import { executeAction, resolveTimeout } from "./action.js";

export interface NavigateData {
	url: string;
	status: number | null;
}

export async function navigate(
	ctx: ActionContext,
	url: string,
	opts: ActionOptions = {},
): Promise<ActionResult<NavigateData>> {
	return executeAction(ctx, "navigate", opts, async (_ctx, timeoutMs) => {
		const response = await _ctx.page.goto(url, {
			waitUntil: "domcontentloaded",
			timeout: timeoutMs,
		});
		return {
			url: _ctx.page.url(),
			status: response?.status() ?? null,
		};
	});
}

export async function reload(
	ctx: ActionContext,
	opts: ActionOptions = {},
): Promise<ActionResult<NavigateData>> {
	return executeAction(ctx, "reload", opts, async (_ctx, timeoutMs) => {
		const response = await _ctx.page.reload({
			waitUntil: "domcontentloaded",
			timeout: timeoutMs,
		});
		return {
			url: _ctx.page.url(),
			status: response?.status() ?? null,
		};
	});
}

export async function goBack(
	ctx: ActionContext,
	opts: ActionOptions = {},
): Promise<ActionResult<NavigateData>> {
	return executeAction(ctx, "goBack", opts, async (_ctx, timeoutMs) => {
		const response = await _ctx.page.goBack({
			waitUntil: "domcontentloaded",
			timeout: timeoutMs,
		});
		return {
			url: _ctx.page.url(),
			status: response?.status() ?? null,
		};
	});
}

export async function goForward(
	ctx: ActionContext,
	opts: ActionOptions = {},
): Promise<ActionResult<NavigateData>> {
	return executeAction(ctx, "goForward", opts, async (_ctx, timeoutMs) => {
		const response = await _ctx.page.goForward({
			waitUntil: "domcontentloaded",
			timeout: timeoutMs,
		});
		return {
			url: _ctx.page.url(),
			status: response?.status() ?? null,
		};
	});
}

export async function waitForNavigation(
	ctx: ActionContext,
	opts: ActionOptions & { urlPattern?: string | RegExp } = {},
): Promise<ActionResult<NavigateData>> {
	const timeoutMs = resolveTimeout(opts.timeout);
	return executeAction(ctx, "waitForNavigation", opts, async (_ctx) => {
		if (opts.urlPattern) {
			await _ctx.page.waitForURL(opts.urlPattern, { timeout: timeoutMs });
		} else {
			await _ctx.page.waitForLoadState("domcontentloaded", { timeout: timeoutMs });
		}
		return {
			url: _ctx.page.url(),
			status: null,
		};
	});
}
