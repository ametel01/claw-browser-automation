import { AssertionFailedError } from "../errors.js";
import type { Selector } from "../selectors/strategy.js";
import { resolveFirstVisible } from "../selectors/strategy.js";
import type { ActionContext, ActionOptions, ActionResult } from "./action.js";
import { executeAction, resolveTimeout } from "./action.js";
import { waitForDomStability } from "./resilience.js";

export async function click(
	ctx: ActionContext,
	selector: Selector,
	opts: ActionOptions = {},
): Promise<ActionResult<void>> {
	const timeoutMs = resolveTimeout(opts.timeout);
	return executeAction(ctx, "click", opts, async (_ctx) => {
		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));
		const locator = await resolveFirstVisible(_ctx.page, selector, timeoutMs);
		await locator.scrollIntoViewIfNeeded({ timeout: timeoutMs });
		await locator.click({ timeout: timeoutMs });
		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));
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
	return executeAction(ctx, "type", opts, async (_ctx) => {
		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));
		const locator = await resolveFirstVisible(_ctx.page, selector, timeoutMs);
		if (opts.clear !== false) {
			await locator.clear({ timeout: timeoutMs });
		}
		if (opts.sequential) {
			const delay = opts.delayMs ?? 80;
			await locator.pressSequentially(text, { delay, timeout: timeoutMs });
		} else {
			await locator.fill(text, { timeout: timeoutMs });
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
	return executeAction(ctx, "selectOption", opts, async (_ctx) => {
		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));
		const locator = await resolveFirstVisible(_ctx.page, selector, timeoutMs);
		const selected = await locator.selectOption(value, { timeout: timeoutMs });
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
	return executeAction(ctx, "check", opts, async (_ctx) => {
		const locator = await resolveFirstVisible(_ctx.page, selector, timeoutMs);
		await locator.check({ timeout: timeoutMs });
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
	return executeAction(ctx, "uncheck", opts, async (_ctx) => {
		const locator = await resolveFirstVisible(_ctx.page, selector, timeoutMs);
		await locator.uncheck({ timeout: timeoutMs });
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
	return executeAction(ctx, "hover", opts, async (_ctx) => {
		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));
		const locator = await resolveFirstVisible(_ctx.page, selector, timeoutMs);
		await locator.hover({ timeout: timeoutMs });
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
		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));
		const sourceLocator = await resolveFirstVisible(_ctx.page, source, timeoutMs);
		const targetLocator = await resolveFirstVisible(_ctx.page, target, timeoutMs);
		await sourceLocator.dragTo(targetLocator, { timeout: timeoutMs });
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
		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));
		const filled: string[] = [];
		const failed: string[] = [];

		for (const [selectorStr, value] of Object.entries(fields)) {
			try {
				const locator = await resolveFirstVisible(_ctx.page, selectorStr, timeoutMs);
				await locator.clear({ timeout: timeoutMs });
				await locator.fill(value, { timeout: timeoutMs });
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
