import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActionResult } from "../../src/actions/action.js";
import type { SessionSnapshot } from "../../src/session/snapshot.js";
import { ActionLog } from "../../src/store/action-log.js";
import { ArtifactManager } from "../../src/store/artifacts.js";
import { Store } from "../../src/store/db.js";
import { SessionStore } from "../../src/store/sessions.js";

describe("Store", () => {
	let tmpDir: string;
	let store: Store;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-test-store-"));
		const dbPath = path.join(tmpDir, "test.db");
		store = new Store({ dbPath });
	});

	afterEach(() => {
		store.close();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should initialize database with schema", () => {
		expect(store.db).toBeDefined();
		const tables = store.db
			.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
			.all() as Array<{ name: string }>;
		const names = tables.map((t) => t.name);
		expect(names).toContain("sessions");
		expect(names).toContain("action_log");
		expect(names).toContain("schema_version");
	});

	it("should be idempotent on re-open", () => {
		const dbPath = path.join(tmpDir, "test.db");
		store.close();
		const store2 = new Store({ dbPath });
		expect(store2.db).toBeDefined();
		store2.close();

		// Re-assign so afterEach doesn't double-close
		store = new Store({ dbPath });
	});
});

describe("SessionStore", () => {
	let tmpDir: string;
	let store: Store;
	let sessions: SessionStore;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-test-sessions-"));
		store = new Store({ dbPath: path.join(tmpDir, "test.db") });
		sessions = new SessionStore(store.db);
	});

	afterEach(() => {
		store.close();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should create and retrieve a session", () => {
		sessions.create("sess-1", "my-profile");
		const record = sessions.get("sess-1");
		expect(record).toBeDefined();
		expect(record?.id).toBe("sess-1");
		expect(record?.profile).toBe("my-profile");
		expect(record?.status).toBe("active");
		expect(record?.snapshot).toBeNull();
	});

	it("should create session without profile", () => {
		sessions.create("sess-2", undefined);
		const record = sessions.get("sess-2");
		expect(record?.profile).toBeNull();
	});

	it("should update session status", () => {
		sessions.create("sess-3", undefined);
		sessions.updateStatus("sess-3", "suspended");
		expect(sessions.get("sess-3")?.status).toBe("suspended");
		sessions.updateStatus("sess-3", "closed");
		expect(sessions.get("sess-3")?.status).toBe("closed");
	});

	it("should save and retrieve snapshot", () => {
		sessions.create("sess-4", "prof");
		const snapshot: SessionSnapshot = {
			sessionId: "sess-4",
			url: "https://example.com",
			cookies: [],
			localStorage: { key: "value" },
			timestamp: Date.now(),
		};
		sessions.saveSnapshot("sess-4", snapshot);
		const record = sessions.get("sess-4");
		expect(record?.snapshot).toEqual(snapshot);
	});

	it("should list sessions by status", () => {
		sessions.create("a1", undefined);
		sessions.create("a2", undefined);
		sessions.create("s1", undefined);
		sessions.updateStatus("s1", "suspended");

		expect(sessions.listActive()).toHaveLength(2);
		expect(sessions.listSuspended()).toHaveLength(1);
		expect(sessions.listSuspended()[0]?.id).toBe("s1");
	});

	it("should suspend all active sessions", () => {
		sessions.create("x1", undefined);
		sessions.create("x2", undefined);
		const count = sessions.suspendAll();
		expect(count).toBe(2);
		expect(sessions.listActive()).toHaveLength(0);
		expect(sessions.listSuspended()).toHaveLength(2);
	});

	it("should close all open sessions", () => {
		sessions.create("y1", undefined);
		sessions.create("y2", undefined);
		sessions.updateStatus("y2", "suspended");
		const count = sessions.closeAll();
		expect(count).toBe(2);
		expect(sessions.listByStatus("closed")).toHaveLength(2);
	});
});

describe("ActionLog", () => {
	let tmpDir: string;
	let store: Store;
	let sessions: SessionStore;
	let actionLog: ActionLog;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-test-actionlog-"));
		store = new Store({ dbPath: path.join(tmpDir, "test.db") });
		sessions = new SessionStore(store.db);
		actionLog = new ActionLog(store.db);
		sessions.create("test-session", undefined);
	});

	afterEach(() => {
		store.close();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function makeResult(ok: boolean): ActionResult {
		return { ok, retries: 0, durationMs: 42 };
	}

	it("should log an action and retrieve it", () => {
		const id = actionLog.log({
			sessionId: "test-session",
			action: "click",
			selector: "#btn",
			input: { selector: "#btn" },
			result: makeResult(true),
		});
		expect(id).toBeGreaterThan(0);

		const entries = actionLog.getBySession("test-session");
		expect(entries).toHaveLength(1);
		expect(entries[0]?.action).toBe("click");
		expect(entries[0]?.selector).toBe("#btn");
		expect(entries[0]?.result.ok).toBe(true);
		expect(entries[0]?.durationMs).toBe(42);
	});

	it("should log multiple actions and count them", () => {
		actionLog.log({ sessionId: "test-session", action: "navigate", result: makeResult(true) });
		actionLog.log({ sessionId: "test-session", action: "click", result: makeResult(true) });
		actionLog.log({ sessionId: "test-session", action: "type", result: makeResult(false) });

		expect(actionLog.countBySession("test-session")).toBe(3);
	});

	it("should get recent actions across sessions", () => {
		sessions.create("s2", undefined);
		actionLog.log({ sessionId: "test-session", action: "navigate", result: makeResult(true) });
		actionLog.log({ sessionId: "s2", action: "click", result: makeResult(true) });

		const recent = actionLog.getRecent(10);
		expect(recent).toHaveLength(2);
	});

	it("should get failures for a session", () => {
		actionLog.log({ sessionId: "test-session", action: "click", result: makeResult(true) });
		actionLog.log({
			sessionId: "test-session",
			action: "type",
			result: { ok: false, error: "timeout", retries: 3, durationMs: 15000 },
		});

		const failures = actionLog.getFailures("test-session");
		expect(failures).toHaveLength(1);
		expect(failures[0]?.action).toBe("type");
		expect(failures[0]?.result.error).toBe("timeout");
	});
});

describe("ArtifactManager", () => {
	let tmpDir: string;
	let artifacts: ArtifactManager;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-test-artifacts-"));
		artifacts = new ArtifactManager({ baseDir: tmpDir });
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should save and list screenshots", async () => {
		const buffer = Buffer.from("fake-png-data");
		const filepath = await artifacts.saveScreenshot("sess-1", buffer, "click", "submit-btn");
		expect(filepath).toContain("sess-1");
		expect(filepath).toContain("click-submit-btn");
		expect(filepath).toMatch(/\.png$/);
		expect(fs.existsSync(filepath)).toBe(true);

		const list = artifacts.listSessionArtifacts("sess-1");
		expect(list).toHaveLength(1);
	});

	it("should save DOM snapshots", async () => {
		const html = "<html><body><h1>Test</h1></body></html>";
		const filepath = await artifacts.saveDomSnapshot("sess-2", html, "extract", "page");
		expect(filepath).toMatch(/\.html$/);
		expect(fs.readFileSync(filepath, "utf8")).toBe(html);
	});

	it("should list sessions with artifacts", async () => {
		await artifacts.saveScreenshot("sess-a", Buffer.from("a"), "test");
		await artifacts.saveScreenshot("sess-b", Buffer.from("b"), "test");

		const sessions = artifacts.listSessions();
		expect(sessions).toContain("sess-a");
		expect(sessions).toContain("sess-b");
	});

	it("should delete session artifacts", async () => {
		await artifacts.saveScreenshot("sess-del", Buffer.from("data"), "test");
		expect(artifacts.deleteSession("sess-del")).toBe(true);
		expect(artifacts.listSessionArtifacts("sess-del")).toHaveLength(0);
		expect(artifacts.deleteSession("sess-del")).toBe(false);
	});

	it("should reject invalid session ids for artifact paths", async () => {
		await expect(
			artifacts.saveScreenshot("../escape", Buffer.from("data"), "test"),
		).rejects.toThrow("invalid session id");
		expect(() => artifacts.deleteSession("../escape")).toThrow("invalid session id");
	});

	it("should enforce retention policy", async () => {
		const manager = new ArtifactManager({ baseDir: tmpDir, maxSessions: 2 });
		await manager.saveScreenshot("aaa-oldest", Buffer.from("1"), "test");
		await manager.saveScreenshot("bbb-middle", Buffer.from("2"), "test");
		await manager.saveScreenshot("ccc-newest", Buffer.from("3"), "test");

		const removed = manager.enforceRetention();
		expect(removed).toBe(1);
		const remaining = manager.listSessions();
		expect(remaining).toHaveLength(2);
		expect(remaining).not.toContain("aaa-oldest");
	});

	it("should enforce retention by session recency, not lexical order", async () => {
		const manager = new ArtifactManager({ baseDir: tmpDir, maxSessions: 2 });
		await manager.saveScreenshot("z-old", Buffer.from("1"), "test");
		await new Promise((resolve) => setTimeout(resolve, 10));
		await manager.saveScreenshot("a-mid", Buffer.from("2"), "test");
		await new Promise((resolve) => setTimeout(resolve, 10));
		await manager.saveScreenshot("b-new", Buffer.from("3"), "test");

		const removed = manager.enforceRetention();
		expect(removed).toBe(1);
		const remaining = manager.listSessions();
		expect(remaining).toContain("a-mid");
		expect(remaining).toContain("b-new");
		expect(remaining).not.toContain("z-old");
	});
});
