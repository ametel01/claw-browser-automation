import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type ActionContext, executeAction } from "../../src/actions/action.js";
import { getAll, getText } from "../../src/actions/extract.js";
import { check, click, fill } from "../../src/actions/interact.js";
import { PopupDismisser } from "../../src/actions/resilience.js";
import { waitForSelector } from "../../src/actions/wait.js";
import { createSkill } from "../../src/index.js";
import type { BrowserPool } from "../../src/pool/browser-pool.js";
import type { BrowserSession } from "../../src/session/session.js";
import { Store } from "../../src/store/db.js";
import { SessionStore } from "../../src/store/sessions.js";
import type { ToolDefinition, ToolResult } from "../../src/tools/session-tools.js";
import {
	ARIA_LABELED,
	CARD_GRID,
	DEFINITION_LIST,
	DELAYED_BUTTON,
	DYNAMIC_SPA,
	FORM,
	HIDDEN_TOGGLE,
	MULTI_COLUMN,
	NESTED_LIST,
	POPUP_BANNER_DISMISS,
	POPUP_BROWSER_DIALOG,
	POPUP_COOKIE_ACCEPT,
	POPUP_GDPR_MODAL,
	POPUP_OVERLAY_CLOSE,
	SIMPLE_TEXT,
	TABLE,
} from "./fixtures.js";
import { createTestPool, waitFor } from "./helpers.js";

function seedArtifactSession(baseDir: string, sessionId: string, ageMsAgo: number): void {
	const dir = path.join(baseDir, sessionId);
	fs.mkdirSync(dir, { recursive: true });
	const now = Date.now();
	const timestamp = (now - ageMsAgo) / 1000;
	fs.utimesSync(dir, new Date(timestamp * 1000), new Date(timestamp * 1000));
}

// ---------------------------------------------------------------------------
// 1. Pool lifecycle (20 cycles)
// ---------------------------------------------------------------------------
describe("Pool lifecycle (20 cycles)", () => {
	let pool: BrowserPool;

	afterEach(async () => {
		await pool.shutdown();
	});

	it("should acquire and release 20 sessions with no leaks", async () => {
		pool = createTestPool({ maxContexts: 1 });

		for (let i = 0; i < 20; i++) {
			const session = await pool.acquire();
			expect(session.isHealthy()).toBe(true);
			await pool.release(session);
			expect(pool.status().activeSessions).toBe(0);
		}

		expect(pool.status().activeSessions).toBe(0);
		expect(pool.status().running).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 2. Navigate + extract on 10 different DOMs
// ---------------------------------------------------------------------------
describe("Navigate + extract on 10 DOMs", () => {
	let pool: BrowserPool;
	let session: BrowserSession;
	let ctx: ActionContext;

	afterEach(async () => {
		if (session) {
			await pool.release(session);
		}
		await pool.shutdown();
	});

	async function setup(html: string): Promise<void> {
		pool = createTestPool();
		session = await pool.acquire();
		await session.page.setContent(html);
		ctx = {
			page: session.page,
			logger: { child: () => ctx.logger } as unknown as ActionContext["logger"],
			info: () => {},
			warn: () => {},
			error: () => {},
			debug: () => {},
			trace: () => {},
			fatal: () => {},
		} as unknown as ActionContext;
	}

	it("simple text", async () => {
		await setup(SIMPLE_TEXT);
		const r = await getText(ctx, "#title", { retries: 0 });
		expect(r.ok).toBe(true);
		expect(r.data).toBe("Welcome to TestPage");
	});

	it("table extraction", async () => {
		await setup(TABLE);
		const r = await getAll(ctx, ".row .name", { retries: 0 });
		expect(r.ok).toBe(true);
		expect(r.data).toHaveLength(3);
		expect(r.data?.[0]?.["textContent"]).toBe("Alice");
		expect(r.data?.[2]?.["textContent"]).toBe("Carol");
	});

	it("nested list", async () => {
		await setup(NESTED_LIST);
		const r = await getAll(ctx, ".item", { retries: 0 });
		expect(r.ok).toBe(true);
		expect(r.data).toHaveLength(4);
		const texts = r.data?.map((d) => d["textContent"]);
		expect(texts).toContain("Apple");
		expect(texts).toContain("Potato");
	});

	it("form fields readable", async () => {
		await setup(FORM);
		const r = await getText(ctx, "#submit", { retries: 0 });
		expect(r.ok).toBe(true);
		expect(r.data).toBe("Submit");
	});

	it("dynamic SPA content", async () => {
		await setup(DYNAMIC_SPA);
		await waitForSelector(ctx, "#spa-content", { timeout: 2000, retries: 0 });
		const r = await getAll(ctx, ".metric", { retries: 0 });
		expect(r.ok).toBe(true);
		expect(r.data).toHaveLength(2);
		expect(r.data?.[0]?.["textContent"]).toContain("Revenue");
	});

	it("ARIA-labeled elements", async () => {
		await setup(ARIA_LABELED);
		const r = await getText(ctx, "#article-body", { retries: 0 });
		expect(r.ok).toBe(true);
		expect(r.data).toContain("accessibility");
	});

	it("hidden/visible toggle", async () => {
		await setup(HIDDEN_TOGGLE);
		await click(ctx, "#toggle-btn", { retries: 0 });
		const r = await getText(ctx, "#secret-text", { retries: 0 });
		expect(r.ok).toBe(true);
		expect(r.data).toContain("now visible");
	});

	it("multi-column layout", async () => {
		await setup(MULTI_COLUMN);
		const r = await getAll(ctx, ".col-text", { retries: 0 });
		expect(r.ok).toBe(true);
		expect(r.data).toHaveLength(3);
		expect(r.data?.[1]?.["textContent"]).toBe("Beta content");
	});

	it("definition list", async () => {
		await setup(DEFINITION_LIST);
		const terms = await getAll(ctx, ".term", { retries: 0 });
		const defs = await getAll(ctx, ".def", { retries: 0 });
		expect(terms.ok).toBe(true);
		expect(defs.ok).toBe(true);
		expect(terms.data).toHaveLength(3);
		expect(defs.data?.[0]?.["textContent"]).toBe("Application Programming Interface");
	});

	it("card grid", async () => {
		await setup(CARD_GRID);
		const r = await getAll(ctx, ".card-title", { retries: 0 });
		expect(r.ok).toBe(true);
		expect(r.data).toHaveLength(4);
		const prices = await getAll(ctx, ".card-price", { retries: 0 });
		expect(prices.data?.[3]?.["textContent"]).toBe("$40");
	});
});

// ---------------------------------------------------------------------------
// 3. Crash recovery
// ---------------------------------------------------------------------------
describe("Crash recovery", { timeout: 20_000 }, () => {
	let pool: BrowserPool;

	afterEach(async () => {
		try {
			await pool.shutdown();
		} catch {
			// Pool may already be in bad state after crash test
		}
	});

	it("should detect browser crash and recover", async () => {
		pool = createTestPool({ healthCheckIntervalMs: 500 });
		const session = await pool.acquire({
			url: "data:text/html,<h1>crash-test</h1>",
		});
		const originalId = session.id;

		// Snapshot before crash
		const snapshot = await session.snapshot();
		expect(snapshot.url).toContain("data:text/html");

		// Kill browser process by closing the page (simulates crash detection)
		await session.page.close();

		// Wait for health monitor to detect and recover
		await waitFor(
			() => {
				const recovered = pool.getSession(originalId);
				return recovered !== undefined && recovered !== session && recovered.isHealthy();
			},
			10_000,
			100,
		);

		// Pool should still be running with a recovered session
		const status = pool.status();
		expect(status.running).toBe(true);
		expect(status.activeSessions).toBe(1);
		const recovered = pool.listSessions()[0];
		expect(recovered).toBeDefined();
		expect(recovered?.id).toBe(originalId);
	});
});

// ---------------------------------------------------------------------------
// 4. Cookie banner auto-dismiss (5 patterns)
// ---------------------------------------------------------------------------
describe("Cookie banner auto-dismiss", () => {
	let pool: BrowserPool;
	let session: BrowserSession;

	afterEach(async () => {
		if (session) {
			await pool.release(session);
		}
		await pool.shutdown();
	});

	async function setupWithDismisser(html: string): Promise<{ dismisser: PopupDismisser }> {
		pool = createTestPool();
		session = await pool.acquire();
		await session.page.setContent(html);
		const noop = () => {};
		const logger = {
			info: noop,
			warn: noop,
			error: noop,
			debug: noop,
			trace: noop,
			fatal: noop,
			child: () => logger,
			level: "silent",
		} as unknown as Parameters<
			typeof PopupDismisser.prototype.start extends () => void ? never : never
		> extends never
			? unknown
			: never;
		const dismisser = new PopupDismisser(
			session.page,
			logger as unknown as ConstructorParameters<typeof PopupDismisser>[1],
			{ checkIntervalMs: 200 },
		);
		return { dismisser };
	}

	it("should dismiss cookie accept button", async () => {
		const { dismisser } = await setupWithDismisser(POPUP_COOKIE_ACCEPT);
		dismisser.start();
		await waitFor(
			async () => {
				const visible = await session.page
					.locator(".cookie-notice")
					.isVisible({ timeout: 100 })
					.catch(() => false);
				return !visible;
			},
			5000,
			200,
		);
		dismisser.stop();
	});

	it("should dismiss GDPR modal", async () => {
		const { dismisser } = await setupWithDismisser(POPUP_GDPR_MODAL);
		dismisser.start();
		await waitFor(
			async () => {
				const visible = await session.page
					.locator("#gdpr-banner")
					.isVisible({ timeout: 100 })
					.catch(() => false);
				return !visible;
			},
			5000,
			200,
		);
		dismisser.stop();
	});

	it("should dismiss overlay close", async () => {
		const { dismisser } = await setupWithDismisser(POPUP_OVERLAY_CLOSE);
		dismisser.start();
		await waitFor(
			async () => {
				const visible = await session.page
					.locator("#overlay-banner")
					.isVisible({ timeout: 100 })
					.catch(() => false);
				return !visible;
			},
			5000,
			200,
		);
		dismisser.stop();
	});

	it("should dismiss banner", async () => {
		const { dismisser } = await setupWithDismisser(POPUP_BANNER_DISMISS);
		dismisser.start();
		await waitFor(
			async () => {
				const visible = await session.page
					.locator("#notif-banner")
					.isVisible({ timeout: 100 })
					.catch(() => false);
				return !visible;
			},
			5000,
			200,
		);
		dismisser.stop();
	});

	it("should auto-dismiss browser dialog", async () => {
		const { dismisser } = await setupWithDismisser(POPUP_BROWSER_DIALOG);
		dismisser.start();
		// Wait for the dialog script to fire and be auto-dismissed
		await waitFor(
			async () => {
				const fired = await session.page
					.evaluate(() => (window as unknown as Record<string, boolean>).__dialogFired === true)
					.catch(() => false);
				return fired;
			},
			5000,
			200,
		);
		dismisser.stop();
		// If the dialog was not auto-dismissed, page would be hung and evaluate would timeout
	});
});

// ---------------------------------------------------------------------------
// 5. Form fill and submit
// ---------------------------------------------------------------------------
describe("Form fill and submit", () => {
	let pool: BrowserPool;
	let session: BrowserSession;

	afterEach(async () => {
		if (session) {
			await pool.release(session);
		}
		await pool.shutdown();
	});

	it("should fill form fields and submit", async () => {
		pool = createTestPool();
		session = await pool.acquire();
		await session.page.setContent(FORM);

		const ctx: ActionContext = {
			page: session.page,
			logger: {
				child: () => ctx.logger,
				info: () => {},
				warn: () => {},
				error: () => {},
				debug: () => {},
				trace: () => {},
				fatal: () => {},
			} as unknown as ActionContext["logger"],
		};

		// Fill text fields
		const fillResult = await fill(
			ctx,
			{
				"#name": "Alice Doe",
				"#email": "alice@example.com",
				"#bio": "Integration test bio",
			},
			{ retries: 0 },
		);
		expect(fillResult.ok).toBe(true);
		expect(fillResult.data?.filled).toContain("#name");
		expect(fillResult.data?.filled).toContain("#email");
		expect(fillResult.data?.filled).toContain("#bio");

		// Select dropdown
		await session.page.selectOption("#role", "admin");

		// Check checkbox
		const checkResult = await check(ctx, "#terms", { retries: 0 });
		expect(checkResult.ok).toBe(true);

		// Click submit
		const clickResult = await click(ctx, "#submit", { retries: 0 });
		expect(clickResult.ok).toBe(true);

		// Verify output
		const output = await getText(ctx, "#output", { retries: 0 });
		expect(output.ok).toBe(true);
		const parsed = JSON.parse(output.data ?? "{}") as Record<string, unknown>;
		expect(parsed["name"]).toBe("Alice Doe");
		expect(parsed["email"]).toBe("alice@example.com");
		expect(parsed["role"]).toBe("admin");
		expect(parsed["bio"]).toBe("Integration test bio");
		expect(parsed["terms"]).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 6. Concurrent sessions (4 parallel)
// ---------------------------------------------------------------------------
describe("Concurrent sessions (4 parallel)", () => {
	let pool: BrowserPool;

	afterEach(async () => {
		await pool.shutdown();
	});

	it("should isolate 4 concurrent sessions with no cross-contamination", async () => {
		pool = createTestPool({ maxContexts: 4 });

		const sessions = await Promise.all([
			pool.acquire(),
			pool.acquire(),
			pool.acquire(),
			pool.acquire(),
		]);

		expect(pool.status().activeSessions).toBe(4);

		// Route each session to a fake origin so localStorage is accessible
		await Promise.all(
			sessions.map(async (s, i) => {
				await s.page.route(`http://test-${i}.local/`, (route) => {
					route.fulfill({
						contentType: "text/html",
						body: `<html><body><h1>Session ${i}</h1></body></html>`,
					});
				});
				await s.page.goto(`http://test-${i}.local/`);
				await s.page.evaluate(
					(idx: number) => localStorage.setItem("sessionIndex", String(idx)),
					i,
				);
			}),
		);

		// Verify each session has correct isolated state
		for (let i = 0; i < sessions.length; i++) {
			const s = sessions[i];
			if (!s) continue;
			const h1 = await s.page.locator("h1").textContent();
			expect(h1).toBe(`Session ${i}`);

			const storedIdx = await s.page.evaluate(() => localStorage.getItem("sessionIndex"));
			expect(storedIdx).toBe(String(i));
		}

		// Release all
		for (const s of sessions) {
			await pool.release(s);
		}
		expect(pool.status().activeSessions).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// 7. Action retry on flaky element
// ---------------------------------------------------------------------------
describe("Action retry on flaky element", () => {
	let pool: BrowserPool;
	let session: BrowserSession;

	afterEach(async () => {
		if (session) {
			await pool.release(session);
		}
		await pool.shutdown();
	});

	it("should retry and succeed clicking a delayed element", async () => {
		pool = createTestPool();
		session = await pool.acquire();
		await session.page.setContent(DELAYED_BUTTON);

		const ctx: ActionContext = {
			page: session.page,
			logger: {
				child: () => ctx.logger,
				info: () => {},
				warn: () => {},
				error: () => {},
				debug: () => {},
				trace: () => {},
				fatal: () => {},
			} as unknown as ActionContext["logger"],
		};

		// Button appears after 1.5s — use 500ms timeout so first attempts fail, forcing retries
		const result = await click(ctx, "#late-btn", {
			retries: 5,
			timeout: 500,
		});

		expect(result.ok).toBe(true);
		expect(result.retries).toBeGreaterThan(0);

		// Verify the click had its effect
		const output = await getText(ctx, "#result", { retries: 0 });
		expect(output.data).toBe("button-clicked");
	});

	it("should report zero retries when retries are aborted by navigation guard", async () => {
		pool = createTestPool();
		session = await pool.acquire();
		await session.page.setContent("<p>Navigation guard</p>");

		const ctx: ActionContext = {
			page: session.page,
			logger: {
				child: () => ctx.logger,
				info: () => {},
				warn: () => {},
				error: () => {},
				debug: () => {},
				trace: () => {},
				fatal: () => {},
			} as unknown as ActionContext["logger"],
		};

		let attempts = 0;
		const result = await executeAction(
			ctx,
			"navigation-guard",
			{ retries: 1, timeout: "short" },
			async (_ctx) => {
				attempts += 1;
				await _ctx.page.goto("data:text/html,<p>new page</p>");
				throw new Error("first attempt failed after navigation");
			},
		);

		expect(result.ok).toBe(false);
		expect(result.structuredError?.code).toBe("NAVIGATION_INTERRUPTED");
		expect(result.retries).toBe(0);
		expect(attempts).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// 8. Agent-driven multi-step sequence (via tools)
// ---------------------------------------------------------------------------
describe("Agent-driven multi-step sequence", { timeout: 30_000 }, () => {
	let skill: Awaited<ReturnType<typeof createSkill>> | undefined;
	let tmpDir: string;

	afterEach(async () => {
		if (skill) {
			await skill.shutdown();
		}
		if (tmpDir) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	function findTool(tools: ToolDefinition[], name: string): ToolDefinition {
		const tool = tools.find((t) => t.name === name);
		if (!tool) {
			throw new Error(`tool not found: ${name}`);
		}
		return tool;
	}

	it("should execute full tool chain: open → navigate → content → extract → screenshot → trace → close", async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-integ-skill-"));
		skill = await createSkill({
			maxContexts: 2,
			headless: true,
			dbPath: path.join(tmpDir, "skill.db"),
			artifactsDir: path.join(tmpDir, "artifacts"),
		});

		const tools = skill.tools;

		// 1. browser_open
		const openResult = await findTool(tools, "browser_open").execute({});
		const sessionId = (openResult.details as { sessionId: string }).sessionId;
		expect(sessionId).toBeTruthy();
		expectValidToolResult(openResult);

		// 2. browser_navigate (using setContent equivalent — navigate to data URI)
		const navResult = await findTool(tools, "browser_navigate").execute({
			sessionId,
			url: "data:text/html,<html><body><h1 id='heading'>Tool Chain Test</h1><p id='para'>Automated extraction works.</p></body></html>",
		});
		expectValidToolResult(navResult);

		// 3. browser_get_content
		const contentResult = await findTool(tools, "browser_get_content").execute({
			sessionId,
		});
		expectValidToolResult(contentResult);
		const content = (contentResult.details as { content: string }).content;
		expect(content).toContain("Tool Chain Test");

		// 4. browser_extract_text
		const extractResult = await findTool(tools, "browser_extract_text").execute({
			sessionId,
			selector: "#para",
		});
		expectValidToolResult(extractResult);
		expect((extractResult.details as { text: string }).text).toBe("Automated extraction works.");

		// 5. browser_screenshot
		const ssResult = await findTool(tools, "browser_screenshot").execute({
			sessionId,
			label: "integ-test",
		});
		expectValidToolResult(ssResult);
		const ssPath = (ssResult.details as { path: string }).path;
		expect(fs.existsSync(ssPath)).toBe(true);

		// 6. browser_session_trace
		const traceResult = await findTool(tools, "browser_session_trace").execute({
			sessionId,
		});
		expectValidToolResult(traceResult);
		const traceEntries = (traceResult.details as { entries: unknown[]; count: number }).entries;
		expect(traceEntries.length).toBeGreaterThanOrEqual(3); // navigate, get_content, extract_text at minimum

		// Verify trace order
		const traceActions = (traceEntries as Array<{ action: string }>).map((e) => e.action);
		expect(traceActions).toContain("navigate");

		// 7. browser_close
		const closeResult = await findTool(tools, "browser_close").execute({
			sessionId,
		});
		expectValidToolResult(closeResult);
	});
});

describe("Artifact retention", () => {
	let skill: Awaited<ReturnType<typeof createSkill>> | undefined;
	let tmpDir = "";
	let artifactsDir = "";

	afterEach(async () => {
		if (skill) {
			await skill.shutdown();
			skill = undefined;
		}
		if (tmpDir) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("should enforce retention during skill startup", async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-artifacts-startup-"));
		artifactsDir = path.join(tmpDir, "artifacts");
		fs.mkdirSync(artifactsDir, { recursive: true });
		seedArtifactSession(artifactsDir, "sess-old", 5000);
		seedArtifactSession(artifactsDir, "sess-mid", 3000);
		seedArtifactSession(artifactsDir, "sess-new", 1000);

		skill = await createSkill({
			maxContexts: 1,
			headless: true,
			dbPath: path.join(tmpDir, "startup.db"),
			artifactsDir,
			artifactsMaxSessions: 2,
		});

		const sessions = fs
			.readdirSync(artifactsDir)
			.filter((entry) => fs.lstatSync(path.join(artifactsDir, entry)).isDirectory())
			.sort();
		expect(sessions).toHaveLength(2);
		expect(sessions).toContain("sess-mid");
		expect(sessions).toContain("sess-new");
		expect(sessions).not.toContain("sess-old");
	});

	it("should enforce retention during skill shutdown", async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-artifacts-shutdown-"));
		artifactsDir = path.join(tmpDir, "artifacts");
		skill = await createSkill({
			maxContexts: 1,
			headless: true,
			dbPath: path.join(tmpDir, "shutdown.db"),
			artifactsDir,
			artifactsMaxSessions: 2,
		});

		seedArtifactSession(artifactsDir, "sess-old", 5000);
		seedArtifactSession(artifactsDir, "sess-mid", 3000);
		seedArtifactSession(artifactsDir, "sess-new", 1000);

		await skill.shutdown();
		skill = undefined;

		const sessions = fs
			.readdirSync(artifactsDir)
			.filter((entry) => fs.lstatSync(path.join(artifactsDir, entry)).isDirectory())
			.sort();
		expect(sessions).toHaveLength(2);
		expect(sessions).toContain("sess-mid");
		expect(sessions).toContain("sess-new");
		expect(sessions).not.toContain("sess-old");
	});
});

function expectValidToolResult(result: ToolResult): void {
	expect(result.content).toBeInstanceOf(Array);
	expect(result.content.length).toBeGreaterThan(0);
	expect(result.content[0]?.type).toBe("text");
	expect(result.details).toBeDefined();
}

// ---------------------------------------------------------------------------
// 9. Session suspend + restore
// ---------------------------------------------------------------------------
describe("Session suspend + restore", () => {
	let tmpDir: string;

	afterEach(() => {
		if (tmpDir) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("should persist and restore session state across pool restarts", async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-integ-restore-"));
		const dbPath = path.join(tmpDir, "restore.db");
		const testOrigin = "http://restore-test.local";
		const testHtml = "<html><body><h1>Restore Test</h1></body></html>";

		// --- Phase 1: Create session, set state, save snapshot ---
		const pool1 = createTestPool();
		const session1 = await pool1.acquire();

		// Route to a real origin so localStorage works
		await session1.page.route(`${testOrigin}/`, (route) => {
			route.fulfill({ contentType: "text/html", body: testHtml });
		});
		await session1.page.goto(`${testOrigin}/`);

		await session1.context.addCookies([
			{
				name: "session_token",
				value: "abc123",
				domain: "restore-test.local",
				path: "/",
			},
		]);
		await session1.page.evaluate(() => {
			localStorage.setItem("user", "alice");
			localStorage.setItem("theme", "dark");
		});

		// Snapshot
		const snapshot = await session1.snapshot();
		expect(snapshot.url).toContain("restore-test.local");
		expect(snapshot.localStorage["user"]).toBe("alice");
		expect(snapshot.localStorage["theme"]).toBe("dark");

		// Save to store
		const store1 = new Store({ dbPath });
		const sessions1 = new SessionStore(store1.db);
		sessions1.create(session1.id, undefined);
		sessions1.saveSnapshot(session1.id, snapshot);
		sessions1.updateStatus(session1.id, "suspended");
		store1.close();

		// Shutdown pool completely
		await pool1.shutdown();

		// --- Phase 2: New pool, restore from store ---
		const pool2 = createTestPool();
		const store2 = new Store({ dbPath });
		const sessions2 = new SessionStore(store2.db);

		// Read the suspended session
		const suspended = sessions2.listSuspended();
		expect(suspended).toHaveLength(1);
		const record = suspended[0];
		expect(record).toBeDefined();
		expect(record?.snapshot).not.toBeNull();

		// Acquire new session and restore — route needed again for the new context
		const session2 = await pool2.acquire();
		await session2.page.route(`${testOrigin}/`, (route) => {
			route.fulfill({ contentType: "text/html", body: testHtml });
		});
		const snapshotToRestore = record?.snapshot;
		if (!snapshotToRestore) {
			throw new Error("snapshot missing from suspended record");
		}
		await session2.restore(snapshotToRestore);

		// Verify URL restored
		expect(session2.currentUrl()).toContain("restore-test.local");

		// Verify localStorage restored
		const user = await session2.page.evaluate(() => localStorage.getItem("user"));
		expect(user).toBe("alice");
		const theme = await session2.page.evaluate(() => localStorage.getItem("theme"));
		expect(theme).toBe("dark");

		// Cleanup
		store2.close();
		await pool2.release(session2);
		await pool2.shutdown();
	});
});
