import type { Browser, BrowserContext, Page } from "playwright-core";
import { chromium } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import type { ActionContext } from "../../src/actions/action.js";
import {
	allOf,
	assertElementGone,
	assertElementText,
	assertElementVisible,
	assertUrlContains,
} from "../../src/actions/assertions.js";

describe("Declarative Assertions", () => {
	let browser: Browser;
	let context: BrowserContext;
	let page: Page;

	afterEach(async () => {
		if (context) {
			await context.close();
		}
		if (browser) {
			await browser.close();
		}
	});

	async function setup(html: string): Promise<ActionContext> {
		browser = await chromium.launch({ headless: true });
		context = await browser.newContext();
		page = await context.newPage();
		await page.setContent(html);
		return {
			page,
			logger: {
				debug() {},
				info() {},
				warn() {},
				error() {},
				child() {
					return this;
				},
			} as unknown as ActionContext["logger"],
		};
	}

	describe("assertUrlContains", () => {
		it("should return true when URL contains substring", async () => {
			const ctx = await setup("<p>hi</p>");
			// page is about:blank after setContent, navigate to a data URL
			await page.goto("data:text/html,<p>test</p>");
			const check = assertUrlContains("data:text/html");
			expect(await check(ctx)).toBe(true);
		});

		it("should return false when URL does not contain substring", async () => {
			const ctx = await setup("<p>hi</p>");
			const check = assertUrlContains("example.com");
			expect(await check(ctx)).toBe(false);
		});
	});

	describe("assertElementVisible", () => {
		it("should return true for visible element", async () => {
			const ctx = await setup('<div id="target">Hello</div>');
			const check = assertElementVisible("#target");
			expect(await check(ctx)).toBe(true);
		});

		it("should return false for hidden element", async () => {
			const ctx = await setup('<div id="target" style="display:none">Hello</div>');
			const check = assertElementVisible("#target");
			expect(await check(ctx)).toBe(false);
		});

		it("should return false for non-existent element", async () => {
			const ctx = await setup("<div>Hello</div>");
			const check = assertElementVisible("#nonexistent");
			expect(await check(ctx)).toBe(false);
		});
	});

	describe("assertElementText", () => {
		it("should match exact text", async () => {
			const ctx = await setup('<span id="msg">Success</span>');
			const check = assertElementText("#msg", "Success");
			expect(await check(ctx)).toBe(true);
		});

		it("should fail on text mismatch", async () => {
			const ctx = await setup('<span id="msg">Failure</span>');
			const check = assertElementText("#msg", "Success");
			expect(await check(ctx)).toBe(false);
		});

		it("should match regex", async () => {
			const ctx = await setup('<span id="msg">Order #12345 confirmed</span>');
			const check = assertElementText("#msg", /Order #\d+ confirmed/);
			expect(await check(ctx)).toBe(true);
		});

		it("should return false for non-existent element", async () => {
			const ctx = await setup("<div>Hello</div>");
			const check = assertElementText("#nonexistent", "anything");
			expect(await check(ctx)).toBe(false);
		});
	});

	describe("assertElementGone", () => {
		it("should return true when element is not present", async () => {
			const ctx = await setup("<div>Hello</div>");
			const check = assertElementGone("#spinner");
			expect(await check(ctx)).toBe(true);
		});

		it("should return false when element is visible", async () => {
			const ctx = await setup('<div id="spinner">Loading...</div>');
			const check = assertElementGone("#spinner");
			expect(await check(ctx)).toBe(false);
		});

		it("should return true when element is hidden", async () => {
			const ctx = await setup('<div id="spinner" style="display:none">Loading...</div>');
			const check = assertElementGone("#spinner");
			expect(await check(ctx)).toBe(true);
		});
	});

	describe("allOf", () => {
		it("should return true when all checks pass", async () => {
			const ctx = await setup('<div id="msg">Done</div>');
			const check = allOf(assertElementVisible("#msg"), assertElementText("#msg", "Done"));
			expect(await check(ctx)).toBe(true);
		});

		it("should return false when any check fails", async () => {
			const ctx = await setup('<div id="msg">Pending</div>');
			const check = allOf(assertElementVisible("#msg"), assertElementText("#msg", "Done"));
			expect(await check(ctx)).toBe(false);
		});

		it("should short-circuit on first failure", async () => {
			const ctx = await setup("<div>Hello</div>");
			let secondCalled = false;
			const check = allOf(assertElementVisible("#nonexistent"), async () => {
				secondCalled = true;
				return true;
			});
			expect(await check(ctx)).toBe(false);
			expect(secondCalled).toBe(false);
		});
	});
});
