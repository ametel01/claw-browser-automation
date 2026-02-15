import type { Browser, BrowserContext, Page } from "playwright-core";
import { chromium } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import type { ActionContext } from "../../src/actions/action.js";
import { executeAction } from "../../src/actions/action.js";
import { getAll, getPageContent, getText } from "../../src/actions/extract.js";
import { click, fill, type as typeAction } from "../../src/actions/interact.js";
import { navigate } from "../../src/actions/navigate.js";
import { getPageState, screenshot, scroll } from "../../src/actions/page.js";
import { waitForSelector } from "../../src/actions/wait.js";
import { TargetNotFoundError } from "../../src/errors.js";
import { createLogger } from "../../src/observe/logger.js";
import { ActionTrace } from "../../src/observe/trace.js";
import type { SelectorStrategy } from "../../src/selectors/strategy.js";

const log = createLogger("test-actions");

describe("Action Engine", () => {
	let browser: Browser;
	let context: BrowserContext;
	let page: Page;
	let ctx: ActionContext;

	afterEach(async () => {
		if (context) {
			await context.close();
		}
		if (browser) {
			await browser.close();
		}
	});

	async function setup(html?: string): Promise<void> {
		browser = await chromium.launch({ headless: true });
		context = await browser.newContext();
		page = await context.newPage();
		if (html) {
			await page.setContent(html);
		}
		ctx = { page, logger: log };
	}

	it("should navigate to a URL and return status", async () => {
		await setup();
		const result = await navigate(ctx, "data:text/html,<h1>Nav Test</h1>", {
			retries: 0,
		});
		expect(result.ok).toBe(true);
		expect(result.data?.url).toContain("data:text/html");
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("should click an element", async () => {
		await setup(`
			<button id="btn" onclick="document.getElementById('out').textContent='clicked'">Click Me</button>
			<div id="out"></div>
		`);

		const result = await click(ctx, "#btn", { retries: 0 });
		expect(result.ok).toBe(true);

		const text = await page.locator("#out").innerText();
		expect(text).toBe("clicked");
	});

	it("should type text into an input", async () => {
		await setup('<input id="inp" type="text" />');

		const result = await typeAction(ctx, "#inp", "hello world", { retries: 0 });
		expect(result.ok).toBe(true);

		const value = await page.locator("#inp").inputValue();
		expect(value).toBe("hello world");
	});

	it("should extract text from an element", async () => {
		await setup("<p id='msg'>Extracted text here</p>");

		const result = await getText(ctx, "#msg", { retries: 0 });
		expect(result.ok).toBe(true);
		expect(result.data).toBe("Extracted text here");
	});

	it("should extract multiple items with getAll", async () => {
		await setup(`
			<ul>
				<li class="item">Alpha</li>
				<li class="item">Beta</li>
				<li class="item">Gamma</li>
			</ul>
		`);

		const result = await getAll(ctx, ".item", { retries: 0 });
		expect(result.ok).toBe(true);
		expect(result.data).toHaveLength(3);
		expect(result.data?.[0]?.["textContent"]).toBe("Alpha");
		expect(result.data?.[2]?.["textContent"]).toBe("Gamma");
	});

	it("should extract with layered selector fallback in getAll", async () => {
		await setup(`
			<ul>
				<li class="item">Alpha</li>
				<li class="item">Beta</li>
			</ul>
		`);

		const selector: SelectorStrategy[] = [
			{ type: "testid", id: "missing" },
			{ type: "css", selector: ".item" },
		];
		const result = await getAll(ctx, selector, { retries: 0 });
		expect(result.ok).toBe(true);
		expect(result.data).toHaveLength(2);
		expect(result.data?.[0]?.["textContent"]).toBe("Alpha");
	});

	it("should get page content without scripts/styles", async () => {
		await setup(`
			<style>body { color: red; }</style>
			<script>console.log('hidden')</script>
			<p>Visible paragraph</p>
			<div>Another visible section</div>
		`);

		const result = await getPageContent(ctx, { retries: 0 });
		expect(result.ok).toBe(true);
		expect(result.data).toContain("Visible paragraph");
		expect(result.data).toContain("Another visible section");
		expect(result.data).not.toContain("console.log");
		expect(result.data).not.toContain("color: red");
	});

	it("should wait for a selector to become visible", async () => {
		await setup(`
			<div id="delayed" style="display:none">Appeared</div>
			<script>setTimeout(() => document.getElementById('delayed').style.display = 'block', 200)</script>
		`);

		const result = await waitForSelector(ctx, "#delayed", { retries: 0, timeout: "short" });
		expect(result.ok).toBe(true);
	});

	it("should wait with layered selector fallback", async () => {
		await setup(`
			<div class="delayed" style="display:none">Appeared</div>
			<script>setTimeout(() => document.querySelector('.delayed').style.display = 'block', 200)</script>
		`);

		const selector: SelectorStrategy[] = [
			{ type: "testid", id: "missing" },
			{ type: "css", selector: ".delayed" },
		];
		const result = await waitForSelector(ctx, selector, { retries: 0, timeout: "short" });
		expect(result.ok).toBe(true);
	});

	it("should fill multiple form fields", async () => {
		await setup(`
			<input id="name" type="text" />
			<input id="email" type="email" />
		`);

		const result = await fill(
			ctx,
			{ "#name": "Alice", "#email": "alice@example.com" },
			{ retries: 0 },
		);
		expect(result.ok).toBe(true);
		expect(result.data?.filled).toContain("#name");
		expect(result.data?.filled).toContain("#email");

		expect(await page.locator("#name").inputValue()).toBe("Alice");
		expect(await page.locator("#email").inputValue()).toBe("alice@example.com");
	});

	it("should get page state", async () => {
		await setup("<title>Test Page</title><p>Content</p>");

		const result = await getPageState(ctx, { retries: 0 });
		expect(result.ok).toBe(true);
		expect(result.data?.title).toBe("Test Page");
		expect(result.data?.readyState).toBe("complete");
		expect(result.data?.isLoading).toBe(false);
	});

	it("should scroll the page", async () => {
		await setup(`<div style="height:5000px">Tall content</div>`);

		const result = await scroll(ctx, "down", { retries: 0, amount: 500 });
		expect(result.ok).toBe(true);

		const scrollY = await page.evaluate(() => window.scrollY);
		expect(scrollY).toBeGreaterThan(0);
	});

	it("should return failure result with retries exhausted", async () => {
		await setup("<p>nothing here</p>");

		const result = await getText(ctx, "#nonexistent", { retries: 1, timeout: 500 });
		expect(result.ok).toBe(false);
		expect(result.retries).toBe(1);
		expect(result.error).toBeTruthy();
	});

	it("should respect precondition check", async () => {
		await setup('<button id="btn">Click</button>');

		let preconditionCalled = false;
		const result = await click(ctx, "#btn", {
			retries: 0,
			precondition: async () => {
				preconditionCalled = true;
				return false;
			},
		});
		expect(preconditionCalled).toBe(true);
		expect(result.ok).toBe(false);
		expect(result.error).toBe("precondition failed");
	});

	it("should take a screenshot", async () => {
		const tmpDir = `/tmp/claw-test-screenshots-${Date.now()}`;
		await setup("<h1>Screenshot Test</h1>");
		ctx.screenshotDir = tmpDir;

		const result = await screenshot(ctx, { retries: 0, label: "test" });
		expect(result.ok).toBe(true);
		expect(result.data).toContain("test.png");

		const { existsSync } = await import("node:fs");
		expect(existsSync(result.data ?? "")).toBe(true);

		const { rmSync } = await import("node:fs");
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should record action trace entries when trace context is provided", async () => {
		await setup("<p id='msg'>Trace target</p>");
		const trace = new ActionTrace();
		ctx.trace = trace;
		ctx.sessionId = "trace-session";

		const success = await getText(ctx, "#msg", { retries: 0 });
		expect(success.ok).toBe(true);
		const failure = await getText(ctx, "#missing", { retries: 0, timeout: 100 });
		expect(failure.ok).toBe(false);

		const sessionTrace = trace.getSessionTrace("trace-session");
		expect(sessionTrace).toHaveLength(2);
		expect(sessionTrace[0]?.ok).toBe(true);
		expect(sessionTrace[1]?.ok).toBe(false);
		expect(trace.stats().actionsTotal).toBe(2);
	});

	it("should not leak structured errors from earlier retries", async () => {
		await setup("<p>Retry state test</p>");
		let attempts = 0;
		const result = await executeAction(
			ctx,
			"retry-state",
			{
				retries: 1,
				postcondition: async () => false,
			},
			async () => {
				attempts += 1;
				if (attempts === 1) {
					throw new TargetNotFoundError("missing on first attempt");
				}
				return "done";
			},
		);
		expect(result.ok).toBe(false);
		expect(result.error).toBe("postcondition failed");
		expect(result.structuredError).toBeUndefined();
	});
});
