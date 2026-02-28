import type { Browser, BrowserContext, Page } from "playwright-core";
import { chromium } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import type { ActionContext } from "../../src/actions/action.js";
import {
	applyFilter,
	selectAutocomplete,
	setDateField,
	setField,
	submitForm,
} from "../../src/actions/semantic.js";

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

describe("Semantic Actions", () => {
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

	describe("setField", () => {
		it("should find input by label and fill it", async () => {
			const ctx = await setup(`
				<label for="email">Email Address</label>
				<input id="email" type="email" />
			`);

			const result = await setField(ctx, "Email Address", "test@example.com", { retries: 0 });
			expect(result.ok).toBe(true);
			expect(result.data?.strategy).toBe("label");
			expect(await page.inputValue("#email")).toBe("test@example.com");
		});

		it("should find input by placeholder", async () => {
			const ctx = await setup(`
				<input type="text" placeholder="Search..." />
			`);

			const result = await setField(ctx, "Search...", "hello", { retries: 0 });
			expect(result.ok).toBe(true);
			expect(result.data?.strategy).toBe("css");
			expect(await page.inputValue("input")).toBe("hello");
		});

		it("should find input by name attribute", async () => {
			const ctx = await setup(`
				<input type="text" name="username" />
			`);

			const result = await setField(ctx, "username", "alice", { retries: 0 });
			expect(result.ok).toBe(true);
			expect(await page.inputValue("input")).toBe("alice");
		});

		it("should find input by aria-label", async () => {
			const ctx = await setup(`
				<input type="text" aria-label="Phone Number" />
			`);

			const result = await setField(ctx, "Phone Number", "555-1234", { retries: 0 });
			expect(result.ok).toBe(true);
			expect(await page.inputValue("input")).toBe("555-1234");
		});

		it("should find textarea by placeholder", async () => {
			const ctx = await setup(`
				<textarea placeholder="Enter comments"></textarea>
			`);

			const result = await setField(ctx, "Enter comments", "Great product!", { retries: 0 });
			expect(result.ok).toBe(true);
			expect(await page.inputValue("textarea")).toBe("Great product!");
		});

		it("should respect scope option", async () => {
			const ctx = await setup(`
				<form id="f1"><input name="q" /></form>
				<form id="f2"><input name="q" /></form>
			`);

			const result = await setField(ctx, "q", "scoped", {
				scope: "#f2",
				retries: 0,
			});
			expect(result.ok).toBe(true);
			expect(await page.inputValue("#f2 input")).toBe("scoped");
		});

		it("should fail for non-existent field", async () => {
			const ctx = await setup("<div>No inputs</div>");
			const result = await setField(ctx, "nope", "value", {
				retries: 0,
				timeout: 2000,
			});
			expect(result.ok).toBe(false);
		});
	});

	describe("submitForm", () => {
		it("should click button[type=submit]", async () => {
			const ctx = await setup(`
				<form>
					<input name="q" />
					<button type="submit" id="btn">Go</button>
				</form>
			`);

			await page.evaluate(() => {
				(window as Window & { __submitted?: boolean }).__submitted = false;
				document.querySelector("form")?.addEventListener("submit", (e) => {
					e.preventDefault();
					(window as Window & { __submitted?: boolean }).__submitted = true;
				});
			});

			const result = await submitForm(ctx, { retries: 0 });
			expect(result.ok).toBe(true);
			expect(result.data?.strategy).toBe("css");
			const submitted = await page.evaluate(
				() => (window as Window & { __submitted?: boolean }).__submitted,
			);
			expect(submitted).toBe(true);
		});

		it("should click input[type=submit] as fallback", async () => {
			const ctx = await setup(`
				<form>
					<input type="submit" value="Submit" id="btn" />
				</form>
			`);

			await page.evaluate(() => {
				(window as Window & { __submitted?: boolean }).__submitted = false;
				document.querySelector("form")?.addEventListener("submit", (e) => {
					e.preventDefault();
					(window as Window & { __submitted?: boolean }).__submitted = true;
				});
			});

			const result = await submitForm(ctx, { retries: 0 });
			expect(result.ok).toBe(true);
			const submitted = await page.evaluate(
				() => (window as Window & { __submitted?: boolean }).__submitted,
			);
			expect(submitted).toBe(true);
		});

		it("should respect scope option", async () => {
			const ctx = await setup(`
				<form id="f1"><button type="submit">Submit 1</button></form>
				<form id="f2"><button type="submit">Submit 2</button></form>
			`);

			await page.evaluate(() => {
				(window as Window & { __which?: string }).__which = "";
				document.getElementById("f1")?.addEventListener("submit", (e) => {
					e.preventDefault();
					(window as Window & { __which?: string }).__which = "f1";
				});
				document.getElementById("f2")?.addEventListener("submit", (e) => {
					e.preventDefault();
					(window as Window & { __which?: string }).__which = "f2";
				});
			});

			const result = await submitForm(ctx, { scope: "#f2", retries: 0 });
			expect(result.ok).toBe(true);
			const which = await page.evaluate(() => (window as Window & { __which?: string }).__which);
			expect(which).toBe("f2");
		});

		it("should fail when no submit button exists", async () => {
			const ctx = await setup("<div>No form</div>");
			const result = await submitForm(ctx, { retries: 0, timeout: 2000 });
			expect(result.ok).toBe(false);
		});
	});

	describe("applyFilter", () => {
		it("should set field and click apply button", async () => {
			const ctx = await setup(`
				<div>
					<label for="search">Search</label>
					<input id="search" type="text" />
					<button type="submit">Apply</button>
				</div>
			`);

			await page.evaluate(() => {
				(window as Window & { __clicked?: boolean }).__clicked = false;
				document.querySelector("button")?.addEventListener("click", () => {
					(window as Window & { __clicked?: boolean }).__clicked = true;
				});
			});

			const result = await applyFilter(ctx, "Search", "test query", { retries: 0 });
			expect(result.ok).toBe(true);
			expect(result.data?.applied).toBe(true);
			expect(await page.inputValue("#search")).toBe("test query");
			const clicked = await page.evaluate(
				() => (window as Window & { __clicked?: boolean }).__clicked,
			);
			expect(clicked).toBe(true);
		});

		it("should use custom applySelector", async () => {
			const ctx = await setup(`
				<input placeholder="Filter..." />
				<button id="custom-apply">Go</button>
			`);

			await page.evaluate(() => {
				(window as Window & { __clicked?: boolean }).__clicked = false;
				document.getElementById("custom-apply")?.addEventListener("click", () => {
					(window as Window & { __clicked?: boolean }).__clicked = true;
				});
			});

			const result = await applyFilter(ctx, "Filter...", "value", {
				applySelector: "#custom-apply",
				retries: 0,
			});
			expect(result.ok).toBe(true);
			expect(result.data?.applied).toBe(true);
			const clicked = await page.evaluate(
				() => (window as Window & { __clicked?: boolean }).__clicked,
			);
			expect(clicked).toBe(true);
		});

		it("should skip apply when skipApply is true", async () => {
			const ctx = await setup(`
				<label for="f">Name</label>
				<input id="f" />
			`);

			const result = await applyFilter(ctx, "Name", "skip test", {
				skipApply: true,
				retries: 0,
			});
			expect(result.ok).toBe(true);
			expect(result.data?.applied).toBe(false);
			expect(await page.inputValue("#f")).toBe("skip test");
		});

	describe("selectAutocomplete", () => {
		it("should type query and choose matching option", async () => {
			const ctx = await setup(`
				<label for="to">To</label>
				<input id="to" aria-label="To" />
				<ul id="options" role="listbox">
					<li role="option">Cebu CEB</li>
					<li role="option">Clark CRK</li>
				</ul>
				<script>
					document.querySelectorAll('#options [role="option"]').forEach((el) => {
						el.addEventListener('click', () => {
							document.getElementById('to').value = el.textContent || '';
						});
					});
				</script>
			`);

			const result = await selectAutocomplete(ctx, "To", "Ceb", "Cebu CEB", { retries: 0 });
			expect(result.ok).toBe(true);
			expect(await page.inputValue('#to')).toBe('Cebu CEB');
		});
	});

	describe("setDateField", () => {
		it("should set date input and dispatch events", async () => {
			const ctx = await setup(`
				<label for="depart">Departing on</label>
				<input id="depart" />
			`);

			const result = await setDateField(ctx, "Departing on", "16 Mar 2026", { retries: 0 });
			expect(result.ok).toBe(true);
			expect(await page.inputValue('#depart')).toBe('16 Mar 2026');
		});
	});
	});
});
