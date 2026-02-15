/**
 * Declarative postcondition assertion factories.
 *
 * Each function returns a `(ctx: ActionContext) => Promise<boolean>` compatible
 * with ActionOptions.postcondition. Compose with `allOf()` for multiple checks.
 */

import type { Selector } from "../selectors/strategy.js";
import { resolveSelector } from "../selectors/strategy.js";
import type { ActionContext } from "./action.js";

export type AssertionCheck = (ctx: ActionContext) => Promise<boolean>;

function recordAssertion(ctx: ActionContext, label: string): void {
	if (!ctx._traceMeta) {
		ctx._traceMeta = {};
	}
	if (!ctx._traceMeta.assertionsChecked) {
		ctx._traceMeta.assertionsChecked = [];
	}
	ctx._traceMeta.assertionsChecked.push(label);
}

export function assertUrlContains(substring: string): AssertionCheck {
	return async (ctx) => {
		recordAssertion(ctx, `urlContains:${substring}`);
		return ctx.page.url().includes(substring);
	};
}

export function assertElementVisible(selector: Selector): AssertionCheck {
	return async (ctx) => {
		recordAssertion(ctx, "elementVisible");
		try {
			const locator = resolveSelector(ctx.page, selector).first();
			return await locator.isVisible({ timeout: 2000 });
		} catch {
			return false;
		}
	};
}

export function assertElementText(selector: Selector, expected: string | RegExp): AssertionCheck {
	return async (ctx) => {
		recordAssertion(
			ctx,
			typeof expected === "string" ? `elementText:${expected}` : `elementText:${expected.source}`,
		);
		try {
			const locator = resolveSelector(ctx.page, selector).first();
			const text = await locator.innerText({ timeout: 2000 });
			if (typeof expected === "string") {
				return text.trim() === expected;
			}
			return expected.test(text.trim());
		} catch {
			return false;
		}
	};
}

export function assertElementGone(selector: Selector): AssertionCheck {
	return async (ctx) => {
		recordAssertion(ctx, "elementGone");
		try {
			const locator = resolveSelector(ctx.page, selector).first();
			const visible = await locator.isVisible({ timeout: 2000 });
			return !visible;
		} catch {
			// Element not found at all → gone
			return true;
		}
	};
}

export function allOf(...checks: AssertionCheck[]): AssertionCheck {
	return async (ctx) => {
		for (const check of checks) {
			if (!(await check(ctx))) {
				return false;
			}
		}
		return true;
	};
}
