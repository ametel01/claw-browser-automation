/**
 * Semantic browser actions that operate on form concepts rather than raw selectors.
 *
 * - `setField` finds an input by label/placeholder/name/aria-label and fills it
 * - `submitForm` finds and clicks the submit button within a form scope
 * - `applyFilter` composes setField + optional apply button click
 */

import type { Locator, Page } from "playwright-core";
import type { SelectorResolution, SelectorStrategy } from "../selectors/strategy.js";
import { resolveWithConfidence } from "../selectors/strategy.js";
import type { ActionContext, ActionOptions, ActionResult } from "./action.js";
import { executeAction, resolveTimeout } from "./action.js";
import type { InputMode } from "./interact.js";
import { type as typeAction } from "./interact.js";
import { waitForDomStability } from "./resilience.js";

export interface SetFieldOptions extends ActionOptions {
	/** Input mode strategy (fill, sequential, paste, nativeSetter). Default: fill. */
	mode?: InputMode;
	/** Delay between keystrokes in sequential mode. */
	delayMs?: number;
	/** CSS selector scoping the search to a particular form or container. */
	scope?: string;
}

export interface SetFieldResult {
	/** The strategy that successfully matched the field. */
	strategy: string;
	/** The identifier used to find the field. */
	identifier: string;
}

export interface SubmitFormOptions extends ActionOptions {
	/** CSS selector scoping the search to a particular form or container. */
	scope?: string;
}

export interface SubmitFormResult {
	/** The strategy that found the submit button. */
	strategy: string;
}

export interface ApplyFilterOptions extends ActionOptions {
	/** Input mode for filling the filter field. */
	mode?: InputMode;
	/** CSS selector for the apply/search button. If not provided, looks for common submit patterns. */
	applySelector?: string;
	/** If true, skip clicking an apply button after setting the field. */
	skipApply?: boolean;
	/** CSS selector scoping the search. */
	scope?: string;
}

export interface ApplyFilterResult {
	fieldStrategy: string;
	applied: boolean;
}

export interface SelectAutocompleteOptions extends ActionOptions {
	mode?: InputMode;
	delayMs?: number;
	scope?: string;
}

export interface SelectAutocompleteResult {
	fieldStrategy: string;
	optionText: string;
}

export interface SetDateFieldOptions extends ActionOptions {
	scope?: string;
}

export interface SetDateFieldResult {
	fieldStrategy: string;
	value: string;
}

function buildFieldStrategies(identifier: string, scope?: string): SelectorStrategy[] {
	const prefix = scope ? `${scope} ` : "";
	return [
		{ type: "css", selector: `${prefix}input[name="${identifier}"]` },
		{ type: "css", selector: `${prefix}textarea[name="${identifier}"]` },
		{ type: "css", selector: `${prefix}select[name="${identifier}"]` },
		{ type: "css", selector: `${prefix}input[placeholder="${identifier}"]` },
		{ type: "css", selector: `${prefix}textarea[placeholder="${identifier}"]` },
		{ type: "css", selector: `${prefix}[aria-label="${identifier}"]` },
		{ type: "label", text: identifier },
	];
}

function buildSubmitStrategies(scope?: string): SelectorStrategy[] {
	const prefix = scope ? `${scope} ` : "";
	return [
		{ type: "css", selector: `${prefix}button[type="submit"]` },
		{ type: "css", selector: `${prefix}input[type="submit"]` },
		{ type: "aria", role: "button", name: "Submit" },
		{ type: "css", selector: `${prefix}button:not([type])` },
	];
}

function buildApplyStrategies(scope?: string): SelectorStrategy[] {
	const prefix = scope ? `${scope} ` : "";
	return [
		{ type: "css", selector: `${prefix}button[type="submit"]` },
		{ type: "aria", role: "button", name: "Apply" },
		{ type: "aria", role: "button", name: "Search" },
		{ type: "aria", role: "button", name: "Filter" },
	];
}

/**
 * Resolve a strategy to a locator without using Playwright's built-in
 * resolution. Used for quick type-based resolution.
 */
function resolveLocator(page: Page, strategy: SelectorStrategy): Locator {
	switch (strategy.type) {
		case "label":
			return page.getByLabel(strategy.text);
		case "aria":
			return page.getByRole(strategy.role as Parameters<Page["getByRole"]>[0], {
				name: strategy.name,
			});
		case "text":
			return strategy.exact !== undefined
				? page.getByText(strategy.text, { exact: strategy.exact })
				: page.getByText(strategy.text);
		case "testid":
			return page.getByTestId(strategy.id);
		case "css":
			return page.locator(strategy.selector);
		case "xpath":
			return page.locator(`xpath=${strategy.expression}`);
	}
}

/**
 * Fast strategy resolution: tries each strategy with instant count() check.
 * Falls back to resolveWithConfidence only if no instant match is found.
 * This avoids the 2s-per-strategy waitFor timeout in resolveWithConfidence.
 */
async function resolveFirstMatch(
	page: Page,
	strategies: SelectorStrategy[],
	timeoutMs: number,
): Promise<SelectorResolution> {
	const start = performance.now();

	// Pass 1: instant check — does the element exist right now?
	for (let i = 0; i < strategies.length; i++) {
		const strategy = strategies[i];
		if (!strategy) continue;
		const locator = resolveLocator(page, strategy);
		const count = await locator.count();
		if (count > 0) {
			return {
				locator,
				strategy,
				strategyIndex: i,
				resolutionMs: Math.round(performance.now() - start),
				chainLength: strategies.length,
			};
		}
	}

	// Pass 2: waited resolution — element may appear after JS execution
	return resolveWithConfidence(page, strategies, "visible", timeoutMs);
}

/**
 * Find an input field by its label, placeholder, name, or aria-label and fill it.
 */
export async function setField(
	ctx: ActionContext,
	identifier: string,
	value: string,
	opts: SetFieldOptions = {},
): Promise<ActionResult<SetFieldResult>> {
	const timeoutMs = resolveTimeout(opts.timeout);
	const strategies = buildFieldStrategies(identifier, opts.scope);

	return executeAction(ctx, "setField", opts, async (_ctx) => {
		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));
		const resolution = await resolveFirstMatch(_ctx.page, strategies, timeoutMs);
		const selector = resolution.strategy;

		const typeOpts: Parameters<typeof typeAction>[3] = {
			timeout: timeoutMs,
			retries: 0,
		};
		if (opts.mode) {
			typeOpts.mode = opts.mode;
		}
		if (opts.delayMs !== undefined) {
			typeOpts.delayMs = opts.delayMs;
		}

		const result = await typeAction(_ctx, selector, value, typeOpts);
		if (!result.ok) {
			throw new Error(result.error ?? "setField: type action failed");
		}

		return { strategy: resolution.strategy.type, identifier };
	});
}

/**
 * Find and click the submit button within a form scope.
 */
export async function submitForm(
	ctx: ActionContext,
	opts: SubmitFormOptions = {},
): Promise<ActionResult<SubmitFormResult>> {
	const timeoutMs = resolveTimeout(opts.timeout);
	const strategies = buildSubmitStrategies(opts.scope);

	return executeAction(ctx, "submitForm", opts, async (_ctx) => {
		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));
		const resolution = await resolveFirstMatch(_ctx.page, strategies, timeoutMs);
		const locator = resolution.locator.first();
		await locator.scrollIntoViewIfNeeded({ timeout: timeoutMs });
		await locator.click({ timeout: timeoutMs });
		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));

		return { strategy: resolution.strategy.type };
	});
}


function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Select an item from an autocomplete/combobox field.
 */
export async function selectAutocomplete(
	ctx: ActionContext,
	identifier: string,
	query: string,
	optionText: string,
	opts: SelectAutocompleteOptions = {},
): Promise<ActionResult<SelectAutocompleteResult>> {
	const timeoutMs = resolveTimeout(opts.timeout);
	const strategies = buildFieldStrategies(identifier, opts.scope);

	return executeAction(ctx, "selectAutocomplete", opts, async (_ctx) => {
		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));
		const resolution = await resolveFirstMatch(_ctx.page, strategies, timeoutMs);
		const selector = resolution.strategy;

		const typeOpts: Parameters<typeof typeAction>[3] = {
			timeout: timeoutMs,
			retries: 0,
			mode: opts.mode ?? "sequential",
		};
		if (opts.delayMs !== undefined) {
			typeOpts.delayMs = opts.delayMs;
		}

		const typed = await typeAction(_ctx, selector, query, typeOpts);
		if (!typed.ok) {
			throw new Error(typed.error ?? "selectAutocomplete: type failed");
		}

		const optionMatchers = [
			_ctx.page.getByRole("option", { name: optionText }),
			_ctx.page.getByText(new RegExp(`^\\s*${escapeRegex(optionText)}\\s*$`, "i")),
			_ctx.page.locator('[role="listbox"] [role="option"]', { hasText: optionText }),
			_ctx.page.locator('li, div[role="option"], button', { hasText: optionText }),
		];

		let clicked = false;
		for (const locator of optionMatchers) {
			const item = locator.first();
			if ((await item.count()) > 0) {
				await item.click({ timeout: timeoutMs });
				clicked = true;
				break;
			}
		}

		if (!clicked) {
			throw new Error(`selectAutocomplete: option not found: ${optionText}`);
		}

		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));
		return { fieldStrategy: resolution.strategy.type, optionText };
	});
}

/**
 * Set a date field value with event dispatch suitable for controlled inputs.
 */
export async function setDateField(
	ctx: ActionContext,
	identifier: string,
	value: string,
	opts: SetDateFieldOptions = {},
): Promise<ActionResult<SetDateFieldResult>> {
	const timeoutMs = resolveTimeout(opts.timeout);
	const strategies = buildFieldStrategies(identifier, opts.scope);

	return executeAction(ctx, "setDateField", opts, async (_ctx) => {
		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));
		const resolution = await resolveFirstMatch(_ctx.page, strategies, timeoutMs);
		const locator = resolution.locator.first();
		await locator.click({ timeout: timeoutMs });
		await locator.evaluate((el, nextValue) => {
			const input = el as HTMLInputElement;
			const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
			if (setter) setter.call(input, nextValue);
			else input.value = nextValue;
			input.dispatchEvent(new Event("input", { bubbles: true }));
			input.dispatchEvent(new Event("change", { bubbles: true }));
			input.dispatchEvent(new Event("blur", { bubbles: true }));
		}, value);
		await locator.press("Enter", { timeout: timeoutMs }).catch(() => {});
		await locator.press("Escape", { timeout: timeoutMs }).catch(() => {});
		const actual = await locator.inputValue({ timeout: timeoutMs });
		if (!actual || actual.trim().length === 0) {
			throw new Error("setDateField: date value not applied");
		}
		return { fieldStrategy: resolution.strategy.type, value: actual };
	});
}

/**
 * Set a filter field and optionally click an apply/search button.
 */
export async function applyFilter(
	ctx: ActionContext,
	fieldIdentifier: string,
	value: string,
	opts: ApplyFilterOptions = {},
): Promise<ActionResult<ApplyFilterResult>> {
	const timeoutMs = resolveTimeout(opts.timeout);

	return executeAction(ctx, "applyFilter", opts, async (_ctx) => {
		// Step 1: Set the field
		const fieldOpts: SetFieldOptions = { timeout: timeoutMs, retries: 0 };
		if (opts.mode) {
			fieldOpts.mode = opts.mode;
		}
		if (opts.scope) {
			fieldOpts.scope = opts.scope;
		}
		const fieldResult = await setField(_ctx, fieldIdentifier, value, fieldOpts);
		if (!fieldResult.ok) {
			throw new Error(fieldResult.error ?? "applyFilter: setField failed");
		}

		// Step 2: Click apply button (unless skipped)
		if (opts.skipApply) {
			return {
				fieldStrategy: fieldResult.data?.strategy ?? "unknown",
				applied: false,
			};
		}

		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));

		if (opts.applySelector) {
			const locator = _ctx.page.locator(opts.applySelector).first();
			await locator.scrollIntoViewIfNeeded({ timeout: timeoutMs });
			await locator.click({ timeout: timeoutMs });
		} else {
			const strategies = buildApplyStrategies(opts.scope);
			const resolution = await resolveFirstMatch(_ctx.page, strategies, timeoutMs);
			const locator = resolution.locator.first();
			await locator.scrollIntoViewIfNeeded({ timeout: timeoutMs });
			await locator.click({ timeout: timeoutMs });
		}

		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));

		return {
			fieldStrategy: fieldResult.data?.strategy ?? "unknown",
			applied: true,
		};
	});
}
