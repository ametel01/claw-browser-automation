import type { Locator, Page } from "playwright-core";

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
			throw new Error("empty selector strategy array");
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
	const locator = await resolveBestSelector(page, selector, "visible", timeoutMs);
	return locator.first();
}

export async function resolveBestSelector(
	page: Page,
	selector: Selector,
	state: SelectorWaitState,
	timeoutMs: number,
): Promise<Locator> {
	if (typeof selector === "string" || !Array.isArray(selector)) {
		return resolveSelector(page, selector);
	}

	if (selector.length === 0) {
		throw new Error("empty selector strategy array");
	}

	// Hidden/detached semantics can pass on missing elements, so fallback probing is not meaningful.
	if (state === "hidden" || state === "detached") {
		const first = selector[0];
		if (!first) {
			throw new Error("empty selector strategy array");
		}
		return resolveOne(page, first);
	}

	const deadline = Date.now() + timeoutMs;
	for (const strategy of selector) {
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			break;
		}
		try {
			const locator = resolveOne(page, strategy);
			await locator.first().waitFor({ state, timeout: Math.min(remaining, 2000) });
			return locator;
		} catch {
			// Strategy didn't match — try next one
		}
	}

	throw new Error(`no selector strategy matched within ${timeoutMs}ms for state ${state}`);
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
