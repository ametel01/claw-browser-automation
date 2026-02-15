import type { Selector } from "../selectors/strategy.js";
import { resolveFirstVisible, resolveWithConfidence } from "../selectors/strategy.js";
import type { ActionContext, ActionOptions, ActionResult } from "./action.js";
import { executeAction, resolveTimeout } from "./action.js";
import { waitForDomStability } from "./resilience.js";

export async function getText(
	ctx: ActionContext,
	selector: Selector,
	opts: ActionOptions = {},
): Promise<ActionResult<string>> {
	const timeoutMs = resolveTimeout(opts.timeout);
	return executeAction(ctx, "getText", opts, async (_ctx) => {
		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));
		const locator = await resolveFirstVisible(_ctx.page, selector, timeoutMs);
		const text = await locator.innerText({ timeout: timeoutMs });
		return text.trim();
	});
}

export async function getAttribute(
	ctx: ActionContext,
	selector: Selector,
	attribute: string,
	opts: ActionOptions = {},
): Promise<ActionResult<string | null>> {
	const timeoutMs = resolveTimeout(opts.timeout);
	return executeAction(ctx, "getAttribute", opts, async (_ctx) => {
		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));
		const locator = await resolveFirstVisible(_ctx.page, selector, timeoutMs);
		return locator.getAttribute(attribute, { timeout: timeoutMs });
	});
}

export interface ExtractedItem {
	[key: string]: string;
}

export async function getAll(
	ctx: ActionContext,
	selector: Selector,
	opts: ActionOptions & { attributes?: string[] } = {},
): Promise<ActionResult<ExtractedItem[]>> {
	const timeoutMs = resolveTimeout(opts.timeout);
	const attrs = opts.attributes ?? ["textContent"];

	return executeAction(ctx, "getAll", opts, async (_ctx) => {
		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));
		const resolution = await resolveWithConfidence(_ctx.page, selector, "attached", timeoutMs);
		const locator = resolution.locator;
		await locator.first().waitFor({ state: "attached", timeout: timeoutMs });

		const count = await locator.count();
		const items: ExtractedItem[] = [];

		for (let i = 0; i < count; i++) {
			const el = locator.nth(i);
			const item: ExtractedItem = {};

			for (const attr of attrs) {
				if (attr === "textContent") {
					const text = await el.innerText({ timeout: timeoutMs });
					item["textContent"] = text.trim();
				} else if (attr === "innerHTML") {
					item["innerHTML"] = await el.innerHTML({ timeout: timeoutMs });
				} else {
					item[attr] = (await el.getAttribute(attr, { timeout: timeoutMs })) ?? "";
				}
			}

			items.push(item);
		}

		return items;
	});
}

export async function getPageContent(
	ctx: ActionContext,
	opts: ActionOptions = {},
): Promise<ActionResult<string>> {
	return executeAction(ctx, "getPageContent", opts, async (_ctx) => {
		const content = await _ctx.page.evaluate(() => {
			const body = document.body;
			if (!body) {
				return "";
			}

			const clone = body.cloneNode(true) as HTMLElement;
			for (const el of clone.querySelectorAll("script, style, noscript, svg")) {
				el.remove();
			}

			return (clone.textContent ?? "")
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line.length > 0)
				.join("\n");
		});
		return content;
	});
}

export async function evaluateExtract<T>(
	ctx: ActionContext,
	fn: () => T | Promise<T>,
	opts: ActionOptions = {},
): Promise<ActionResult<T>> {
	return executeAction(ctx, "evaluateExtract", opts, async (_ctx) => {
		return _ctx.page.evaluate(fn);
	});
}
