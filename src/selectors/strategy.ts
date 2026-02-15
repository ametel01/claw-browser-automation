import type { Locator, Page } from "playwright-core";
import { TargetNotFoundError } from "../errors.js";

export interface SelectorResolution {
	locator: Locator;
	strategy: SelectorStrategy;
	strategyIndex: number;
	resolutionMs: number;
	chainLength: number;
}

export type SelectorStrategy =
	| { type: "aria"; role: string; name: string }
	| { type: "text"; text: string; exact?: boolean }
	| { type: "label"; text: string }
	| { type: "testid"; id: string }
	| { type: "css"; selector: string }
	| { type: "xpath"; expression: string };

export type Selector = string | SelectorStrategy | SelectorStrategy[];
export type SelectorWaitState = "visible" | "hidden" | "attached" | "detached";

export function resolveSelector(page: Page, selector: Selector): Locator {
	if (typeof selector === "string") {
		return page.locator(selector);
	}

	if (Array.isArray(selector)) {
		const first = selector[0];
		if (!first) {
			throw new TargetNotFoundError("empty selector strategy array");
		}
		return resolveOne(page, first);
	}

	return resolveOne(page, selector);
}

export async function resolveFirstVisible(
	page: Page,
	selector: Selector,
	timeoutMs: number,
): Promise<Locator> {
	const resolution = await resolveWithConfidence(page, selector, "visible", timeoutMs);
	return resolution.locator.first();
}

export async function resolveWithConfidence(
	page: Page,
	selector: Selector,
	state: SelectorWaitState,
	timeoutMs: number,
): Promise<SelectorResolution> {
	const start = performance.now();

	if (typeof selector === "string") {
		const locator = page.locator(selector);
		const strategy: SelectorStrategy = { type: "css", selector };
		return {
			locator,
			strategy,
			strategyIndex: 0,
			resolutionMs: Math.round(performance.now() - start),
			chainLength: 1,
		};
	}

	if (!Array.isArray(selector)) {
		const locator = resolveOne(page, selector);
		return {
			locator,
			strategy: selector,
			strategyIndex: 0,
			resolutionMs: Math.round(performance.now() - start),
			chainLength: 1,
		};
	}

	if (selector.length === 0) {
		throw new TargetNotFoundError("empty selector strategy array");
	}

	// Hidden/detached semantics can pass on missing elements, so fallback probing is not meaningful.
	if (state === "hidden" || state === "detached") {
		const first = selector[0];
		if (!first) {
			throw new TargetNotFoundError("empty selector strategy array");
		}
		return {
			locator: resolveOne(page, first),
			strategy: first,
			strategyIndex: 0,
			resolutionMs: Math.round(performance.now() - start),
			chainLength: selector.length,
		};
	}

	const deadline = Date.now() + timeoutMs;
	for (let i = 0; i < selector.length; i++) {
		const strategy = selector[i];
		if (!strategy) {
			continue;
		}
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			break;
		}
		try {
			const locator = resolveOne(page, strategy);
			await locator.first().waitFor({ state, timeout: Math.min(remaining, 2000) });
			return {
				locator,
				strategy,
				strategyIndex: i,
				resolutionMs: Math.round(performance.now() - start),
				chainLength: selector.length,
			};
		} catch {
			// Strategy didn't match — try next one
		}
	}

	throw new TargetNotFoundError(
		`no selector strategy matched within ${timeoutMs}ms for state ${state}`,
		"Try a different selector strategy or increase the timeout.",
	);
}

/** @deprecated Use resolveWithConfidence — this wrapper extracts .locator for backward compat */
export async function resolveBestSelector(
	page: Page,
	selector: Selector,
	state: SelectorWaitState,
	timeoutMs: number,
): Promise<Locator> {
	const resolution = await resolveWithConfidence(page, selector, state, timeoutMs);
	return resolution.locator;
}

function resolveOne(page: Page, strategy: SelectorStrategy): Locator {
	switch (strategy.type) {
		case "aria":
			return page.getByRole(strategy.role as Parameters<Page["getByRole"]>[0], {
				name: strategy.name,
			});
		case "text":
			return strategy.exact !== undefined
				? page.getByText(strategy.text, { exact: strategy.exact })
				: page.getByText(strategy.text);
		case "label":
			return page.getByLabel(strategy.text);
		case "testid":
			return page.getByTestId(strategy.id);
		case "css":
			return page.locator(strategy.selector);
		case "xpath":
			return page.locator(`xpath=${strategy.expression}`);
	}
}
