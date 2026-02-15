import type { Browser, BrowserContext, Page } from "playwright-core";
import { chromium } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import type { SelectorStrategy } from "../../src/selectors/strategy.js";
import {
	resolveBestSelector,
	resolveFirstVisible,
	resolveSelector,
	resolveWithConfidence,
} from "../../src/selectors/strategy.js";

describe("Selector Strategy", () => {
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

	async function setup(html: string): Promise<void> {
		browser = await chromium.launch({ headless: true });
		context = await browser.newContext();
		page = await context.newPage();
		await page.setContent(html);
	}

	it("should resolve a CSS string selector", async () => {
		await setup('<div id="target">Hello</div>');
		const locator = resolveSelector(page, "#target");
		expect(await locator.innerText()).toBe("Hello");
	});

	it("should resolve an ARIA strategy", async () => {
		await setup('<button role="button">Submit</button>');
		const locator = resolveSelector(page, { type: "aria", role: "button", name: "Submit" });
		expect(await locator.innerText()).toBe("Submit");
	});

	it("should resolve a text strategy", async () => {
		await setup("<p>Some unique text here</p>");
		const locator = resolveSelector(page, { type: "text", text: "Some unique text here" });
		expect(await locator.count()).toBe(1);
	});

	it("should resolve a label strategy", async () => {
		await setup('<label>Email<input type="email" /></label>');
		const locator = resolveSelector(page, { type: "label", text: "Email" });
		expect(await locator.count()).toBe(1);
	});

	it("should resolve a testid strategy", async () => {
		await setup('<div data-testid="my-widget">Content</div>');
		const locator = resolveSelector(page, { type: "testid", id: "my-widget" });
		expect(await locator.innerText()).toBe("Content");
	});

	it("should resolve an xpath strategy", async () => {
		await setup("<ul><li>First</li><li>Second</li></ul>");
		const locator = resolveSelector(page, { type: "xpath", expression: "//li[2]" });
		expect(await locator.innerText()).toBe("Second");
	});

	it("should resolve first strategy from an array", async () => {
		await setup('<button data-testid="btn">Click</button>');
		const strategies: SelectorStrategy[] = [
			{ type: "testid", id: "btn" },
			{ type: "css", selector: "button" },
		];
		const locator = resolveSelector(page, strategies);
		expect(await locator.innerText()).toBe("Click");
	});

	it("should throw on empty strategy array", () => {
		// page not needed for this test
		expect(() => resolveSelector(undefined as unknown as Page, [])).toThrow(
			"empty selector strategy array",
		);
	});

	it("should resolve first visible from layered strategies with fallback", async () => {
		await setup('<span class="fallback">Found via CSS</span>');
		const strategies: SelectorStrategy[] = [
			{ type: "testid", id: "nonexistent" },
			{ type: "css", selector: ".fallback" },
		];
		const locator = await resolveFirstVisible(page, strategies, 5000);
		expect(await locator.innerText()).toBe("Found via CSS");
	});

	it("should resolve best selector for attached state with fallback", async () => {
		await setup('<span class="fallback">Found via attached fallback</span>');
		const strategies: SelectorStrategy[] = [
			{ type: "testid", id: "nonexistent" },
			{ type: "css", selector: ".fallback" },
		];
		const locator = await resolveBestSelector(page, strategies, "attached", 5000);
		expect(await locator.first().innerText()).toBe("Found via attached fallback");
	});

	it("should return selector confidence metadata", async () => {
		await setup('<span class="fallback">Found via confidence</span>');
		const strategies: SelectorStrategy[] = [
			{ type: "testid", id: "nonexistent" },
			{ type: "css", selector: ".fallback" },
		];
		const resolution = await resolveWithConfidence(page, strategies, "visible", 5000);
		expect(resolution.strategy.type).toBe("css");
		expect(resolution.strategyIndex).toBe(1);
		expect(resolution.chainLength).toBe(2);
		expect(resolution.resolutionMs).toBeGreaterThanOrEqual(0);
		expect(await resolution.locator.first().innerText()).toBe("Found via confidence");
	});
});
