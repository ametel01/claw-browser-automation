import { Type } from "@sinclair/typebox";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { chromium } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import type { ActionContext } from "../../src/actions/action.js";
import { extractStructured } from "../../src/actions/extract-structured.js";
import { type as typeAction } from "../../src/actions/interact.js";

function mockLogger(): ActionContext["logger"] {
	return {
		debug() {},
		info() {},
		warn() {},
		error() {},
		child() {
			return this;
		},
	} as unknown as ActionContext["logger"];
}

describe("Structured Extraction", () => {
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
		return { page, logger: mockLogger() };
	}

	it("should extract structured data with text and attributes", async () => {
		const ctx = await setup(`
			<ul>
				<li data-id="1"><a href="/a">Alpha</a></li>
				<li data-id="2"><a href="/b">Beta</a></li>
				<li data-id="3"><a href="/c">Gamma</a></li>
			</ul>
		`);

		const schema = Type.Object({
			textContent: Type.String(),
			"data-id": Type.String(),
		});

		const result = await extractStructured(ctx, "li", schema, { retries: 0 });
		expect(result.ok).toBe(true);
		expect(result.data?.data).toHaveLength(3);
		expect(result.data?.data[0]).toEqual({ textContent: "Alpha", "data-id": "1" });
		expect(result.data?.data[2]).toEqual({ textContent: "Gamma", "data-id": "3" });
	});

	it("should include provenance for each item", async () => {
		const ctx = await setup(`
			<div class="card" id="c1">Card 1</div>
			<div class="card" id="c2">Card 2</div>
		`);

		const schema = Type.Object({ textContent: Type.String() });
		const result = await extractStructured(ctx, "div.card", schema, { retries: 0 });

		expect(result.ok).toBe(true);
		expect(result.data?.provenance).toHaveLength(2);
		expect(result.data?.provenance[0]?.tagName).toBe("div");
		expect(result.data?.provenance[0]?.id).toBe("c1");
		expect(result.data?.provenance[0]?.className).toBe("card");
		expect(result.data?.provenance[0]?.strategy).toBe("css");
	});

	it("should support field mapping via schema descriptions", async () => {
		const ctx = await setup(`
			<ul>
				<li><a href="/alpha">Alpha</a></li>
				<li><a href="/beta">Beta</a></li>
			</ul>
		`);

		const schema = Type.Object({
			name: Type.String({ description: "textContent" }),
			link: Type.String({ description: "href" }),
		});

		const result = await extractStructured(ctx, "a", schema, { retries: 0 });
		expect(result.ok).toBe(true);
		expect(result.data?.data).toEqual([
			{ name: "Alpha", link: "/alpha" },
			{ name: "Beta", link: "/beta" },
		]);
	});

	it("should respect limit option", async () => {
		const ctx = await setup(`
			<p>One</p><p>Two</p><p>Three</p><p>Four</p>
		`);

		const schema = Type.Object({ textContent: Type.String() });
		const result = await extractStructured(ctx, "p", schema, { limit: 2, retries: 0 });

		expect(result.ok).toBe(true);
		expect(result.data?.data).toHaveLength(2);
		expect(result.data?.data[0]).toEqual({ textContent: "One" });
		expect(result.data?.data[1]).toEqual({ textContent: "Two" });
	});

	it("should extract innerHTML when requested", async () => {
		const ctx = await setup(`
			<div class="rich"><strong>Bold</strong> text</div>
		`);

		const schema = Type.Object({ innerHTML: Type.String() });
		const result = await extractStructured(ctx, "div.rich", schema, { retries: 0 });

		expect(result.ok).toBe(true);
		expect(result.data?.data[0]?.innerHTML).toContain("<strong>Bold</strong>");
	});

	it("should return empty data for no matches", async () => {
		const ctx = await setup("<div>Nothing here</div>");
		const schema = Type.Object({ textContent: Type.String() });
		const result = await extractStructured(ctx, ".nonexistent", schema, {
			retries: 0,
			timeout: 2000,
		});

		// Should fail since no elements found
		expect(result.ok).toBe(false);
	});
});

describe("Input Modes", () => {
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
		return { page, logger: mockLogger() };
	}

	it("should type using fill mode (default)", async () => {
		const ctx = await setup('<input id="input" type="text" />');
		const result = await typeAction(ctx, "#input", "hello fill", { retries: 0 });
		expect(result.ok).toBe(true);
		expect(await page.inputValue("#input")).toBe("hello fill");
	});

	it("should type using sequential mode", async () => {
		const ctx = await setup('<input id="input" type="text" />');
		const result = await typeAction(ctx, "#input", "seq", {
			mode: "sequential",
			delayMs: 10,
			retries: 0,
		});
		expect(result.ok).toBe(true);
		expect(await page.inputValue("#input")).toBe("seq");
	});

	it("should type using paste mode", async () => {
		const ctx = await setup('<input id="input" type="text" />');
		const result = await typeAction(ctx, "#input", "pasted text", {
			mode: "paste",
			retries: 0,
		});
		expect(result.ok).toBe(true);
		// paste mode uses evaluate + fallback, value should be set
		expect(await page.inputValue("#input")).toBe("pasted text");
	});

	it("should type using nativeSetter mode", async () => {
		const ctx = await setup('<input id="input" type="text" />');
		const result = await typeAction(ctx, "#input", "native value", {
			mode: "nativeSetter",
			retries: 0,
		});
		expect(result.ok).toBe(true);
		expect(await page.inputValue("#input")).toBe("native value");
	});

	it("should respect mode over deprecated sequential flag", async () => {
		const ctx = await setup('<input id="input" type="text" />');
		// mode takes precedence over sequential boolean
		const result = await typeAction(ctx, "#input", "mode wins", {
			mode: "fill",
			sequential: true,
			retries: 0,
		});
		expect(result.ok).toBe(true);
		expect(await page.inputValue("#input")).toBe("mode wins");
	});
});
