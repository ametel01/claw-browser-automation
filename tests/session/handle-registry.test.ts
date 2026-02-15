import type { Browser, BrowserContext, Page } from "playwright-core";
import { chromium } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { HandleRegistry } from "../../src/session/handle-registry.js";

describe("HandleRegistry", () => {
	let browser: Browser;
	let context: BrowserContext;
	let page: Page;
	let registry: HandleRegistry;

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
		registry = new HandleRegistry();
	}

	it("should register an element and return a handle", async () => {
		await setup('<button id="btn">Click me</button>');
		const handle = await registry.register(page, { type: "css", selector: "#btn" });
		expect(handle.handleId).toBeTruthy();
		expect(handle.lastStrategy).toEqual({ type: "css", selector: "#btn" });
		expect(handle.remapCount).toBe(0);
		expect(registry.size).toBe(1);
	});

	it("should resolve a registered handle to a locator", async () => {
		await setup('<button id="btn">Click me</button>');
		const handle = await registry.register(page, { type: "css", selector: "#btn" });
		const resolution = await registry.resolve(page, handle.handleId);
		expect(resolution.locator).toBeDefined();
		expect(resolution.remapped).toBe(false);
		expect(resolution.handle.handleId).toBe(handle.handleId);
	});

	it("should resolve handle after DOM content changes", async () => {
		await setup('<div id="target">Original</div>');
		const handle = await registry.register(page, { type: "css", selector: "#target" });

		// Change the text content
		await page.evaluate(() => {
			const el = document.getElementById("target");
			if (el) el.textContent = "Modified";
		});

		const resolution = await registry.resolve(page, handle.handleId);
		expect(resolution.locator).toBeDefined();
		const text = await resolution.locator.first().textContent();
		expect(text).toBe("Modified");
	});

	it("should detect remapping when primary strategy fails", async () => {
		await setup('<button id="btn" data-testid="action-btn">Click</button>');

		const handle = await registry.register(page, [
			{ type: "css", selector: "#btn" },
			{ type: "testid", id: "action-btn" },
		]);
		expect(handle.lastStrategy).toEqual({ type: "css", selector: "#btn" });

		// Remove the id, forcing fallback to testid
		await page.evaluate(() => {
			const el = document.getElementById("btn");
			if (el) el.removeAttribute("id");
		});

		const resolution = await registry.resolve(page, handle.handleId);
		expect(resolution.remapped).toBe(true);
		expect(resolution.handle.remapCount).toBe(1);
		expect(resolution.handle.lastStrategy).toEqual({ type: "testid", id: "action-btn" });
	});

	it("should throw StaleElementError for unknown handle", async () => {
		await setup("<div>test</div>");
		await expect(registry.resolve(page, "nonexistent")).rejects.toThrow("handle not found");
	});

	it("should release a handle", async () => {
		await setup('<button id="btn">Click</button>');
		const handle = await registry.register(page, { type: "css", selector: "#btn" });
		expect(registry.size).toBe(1);
		const released = registry.release(handle.handleId);
		expect(released).toBe(true);
		expect(registry.size).toBe(0);
	});

	it("should return false when releasing unknown handle", async () => {
		await setup("<div>test</div>");
		expect(registry.release("unknown")).toBe(false);
	});

	it("should clear all handles", async () => {
		await setup('<button id="a">A</button><button id="b">B</button>');
		await registry.register(page, { type: "css", selector: "#a" });
		await registry.register(page, { type: "css", selector: "#b" });
		expect(registry.size).toBe(2);
		registry.clear();
		expect(registry.size).toBe(0);
	});

	it("should list all registered handles", async () => {
		await setup('<button id="a">A</button><button id="b">B</button>');
		await registry.register(page, { type: "css", selector: "#a" });
		await registry.register(page, { type: "css", selector: "#b" });
		const handles = registry.list();
		expect(handles).toHaveLength(2);
	});

	it("should get a handle by ID without resolving", async () => {
		await setup('<button id="btn">Click</button>');
		const handle = await registry.register(page, { type: "css", selector: "#btn" });
		const retrieved = registry.get(handle.handleId);
		expect(retrieved).toBe(handle);
		expect(registry.get("nonexistent")).toBeUndefined();
	});

	it("should prioritize last successful strategy on re-resolve", async () => {
		await setup('<button id="btn" data-testid="action-btn">Click</button>');

		const handle = await registry.register(page, [
			{ type: "css", selector: "#btn" },
			{ type: "testid", id: "action-btn" },
		]);

		// First resolve uses CSS
		const r1 = await registry.resolve(page, handle.handleId);
		expect(r1.resolution.strategy).toEqual({ type: "css", selector: "#btn" });

		// Remove id, forcing testid
		await page.evaluate(() => {
			const el = document.getElementById("btn");
			if (el) el.removeAttribute("id");
		});

		const r2 = await registry.resolve(page, handle.handleId);
		expect(r2.remapped).toBe(true);
		expect(r2.resolution.strategy).toEqual({ type: "testid", id: "action-btn" });

		// On next resolve, testid should be tried first (since it was last successful)
		const r3 = await registry.resolve(page, handle.handleId);
		expect(r3.remapped).toBe(false);
		expect(r3.resolution.strategyIndex).toBe(0); // testid is now first
	});

	it("should register with array selector", async () => {
		await setup('<input id="email" type="email" />');
		const handle = await registry.register(page, [
			{ type: "css", selector: "#email" },
			{ type: "css", selector: "input[type=email]" },
		]);
		expect(handle.handleId).toBeTruthy();
		expect(handle.lastStrategy).toEqual({ type: "css", selector: "#email" });
	});
});
