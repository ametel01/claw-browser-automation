import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionTrace } from "../../src/observe/trace.js";
import { ActionLog } from "../../src/store/action-log.js";
import { ArtifactManager } from "../../src/store/artifacts.js";
import { Store } from "../../src/store/db.js";
import { SessionStore } from "../../src/store/sessions.js";
import { createActionTools } from "../../src/tools/action-tools.js";
import { createApprovalTools } from "../../src/tools/approval-tools.js";
import type { SkillContext } from "../../src/tools/context.js";
import { getSession, makeActionContext, resolveLocatorParam } from "../../src/tools/context.js";
import { createHandleTools } from "../../src/tools/handle-tools.js";
import { createPageTools } from "../../src/tools/page-tools.js";
import { createSemanticTools } from "../../src/tools/semantic-tools.js";
import type { ToolDefinition } from "../../src/tools/session-tools.js";
import { createSessionTools } from "../../src/tools/session-tools.js";

function createMockLogger() {
	const noop = vi.fn();
	return {
		info: noop,
		warn: noop,
		error: noop,
		debug: noop,
		trace: noop,
		fatal: noop,
		child: () => createMockLogger(),
		level: "silent",
	};
}

function createMockSession(id: string, url = "about:blank") {
	const handles = {
		register: vi.fn(async (_page: unknown, selector: unknown) => ({
			handleId: "hdl-1",
			selector,
			lastStrategy: { type: "css", selector: "#mock" },
			remapCount: 0,
		})),
		resolve: vi.fn(async () => ({
			locator: { first: () => ({}) },
			handle: {
				handleId: "hdl-1",
				selector: { type: "css", selector: "#from-handle" },
				lastStrategy: { type: "css", selector: "#from-handle" },
				remapCount: 0,
			},
			resolution: {
				locator: { first: () => ({}) },
				strategy: { type: "css", selector: "#from-handle" },
				strategyIndex: 0,
				resolutionMs: 1,
				chainLength: 1,
			},
			remapped: false,
		})),
		release: vi.fn(() => true),
		clear: vi.fn(),
	};

	return {
		id,
		page: {
			url: () => url,
			title: () => Promise.resolve("Test Page"),
			evaluate: () => Promise.resolve("complete"),
		},
		handles,
		context: {},
		profile: undefined,
		currentUrl: () => url,
		isHealthy: () => true,
		snapshot: vi.fn(async () => ({
			sessionId: id,
			url,
			cookies: [],
			localStorage: {},
			timestamp: Date.now(),
		})),
		restore: vi.fn(),
	};
}

function createMockPool(sessions: Map<string, ReturnType<typeof createMockSession>> = new Map()) {
	return {
		acquire: vi.fn(async (opts?: { url?: string; profile?: string }) => {
			const session = createMockSession(`sess-${sessions.size + 1}`, opts?.url ?? "about:blank");
			sessions.set(session.id, session);
			return session;
		}),
		release: vi.fn(),
		getSession: vi.fn((id: string) => sessions.get(id) ?? null),
		listSessions: vi.fn(() => [...sessions.values()]),
		shutdown: vi.fn(),
	};
}

function findTool(tools: ToolDefinition[], name: string): ToolDefinition {
	const tool = tools.find((t) => t.name === name);
	if (!tool) {
		throw new Error(`tool not found: ${name}`);
	}
	return tool;
}

describe("Tool definitions", () => {
	let tmpDir: string;
	let store: Store;
	let ctx: SkillContext;
	let pool: ReturnType<typeof createMockPool>;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-test-tools-"));
		const dbPath = path.join(tmpDir, "test.db");
		store = new Store({ dbPath });
		pool = createMockPool();
		ctx = {
			pool: pool as unknown as SkillContext["pool"],
			store,
			sessions: new SessionStore(store.db),
			actionLog: new ActionLog(store.db),
			artifacts: new ArtifactManager({
				logger: createMockLogger() as unknown as SkillContext["logger"],
				baseDir: path.join(tmpDir, "artifacts"),
			}),
			trace: new ActionTrace(),
			logger: createMockLogger() as unknown as SkillContext["logger"],
		};
	});

	afterEach(() => {
		store.close();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("createSessionTools", () => {
		let tools: ToolDefinition[];

		beforeEach(() => {
			tools = createSessionTools(ctx);
		});

		it("should create expected session tools", () => {
			const names = tools.map((t) => t.name);
			expect(names).toContain("browser_open");
			expect(names).toContain("browser_close");
			expect(names).toContain("browser_list");
			expect(names).toContain("browser_restore");
			expect(names).toContain("browser_state");
			expect(tools).toHaveLength(5);
		});

		it("should have labels and descriptions on all tools", () => {
			for (const tool of tools) {
				expect(tool.label).toBeTruthy();
				expect(tool.description).toBeTruthy();
				expect(tool.parameters).toBeDefined();
			}
		});

		it("browser_open should acquire a session and return its id", async () => {
			const tool = findTool(tools, "browser_open");
			const result = await tool.execute({ url: "https://example.com" });
			expect(pool.acquire).toHaveBeenCalledWith({
				url: "https://example.com",
			});
			expect(result.details).toHaveProperty("sessionId");
		});

		it("browser_open without params should still work", async () => {
			const tool = findTool(tools, "browser_open");
			const result = await tool.execute({});
			expect(pool.acquire).toHaveBeenCalledWith({});
			expect(result.details).toHaveProperty("sessionId");
		});

		it("browser_close should release the session", async () => {
			const openTool = findTool(tools, "browser_open");
			const openResult = await openTool.execute({});
			const sessionId = (openResult.details as { sessionId: string }).sessionId;

			const closeTool = findTool(tools, "browser_close");
			await closeTool.execute({ sessionId });
			expect(pool.release).toHaveBeenCalled();
			expect(ctx.sessions.get(sessionId)?.snapshot).not.toBeNull();
		});

		it("browser_list should return session list", async () => {
			const openTool = findTool(tools, "browser_open");
			await openTool.execute({});

			const listTool = findTool(tools, "browser_list");
			const result = await listTool.execute({});
			const details = result.details as { sessions: unknown[] };
			expect(details.sessions).toHaveLength(1);
		});

		it("browser_state should return page state", async () => {
			const openTool = findTool(tools, "browser_open");
			const openResult = await openTool.execute({});
			const sessionId = (openResult.details as { sessionId: string }).sessionId;

			const stateTool = findTool(tools, "browser_state");
			const result = await stateTool.execute({ sessionId });
			const details = result.details as {
				url: string;
				title: string;
				readyState: string;
			};
			expect(details.url).toBe("about:blank");
			expect(details.title).toBe("Test Page");
		});
	});

	describe("createActionTools", () => {
		let tools: ToolDefinition[];

		beforeEach(() => {
			tools = createActionTools(ctx);
		});

		it("should create expected action tools", () => {
			const names = tools.map((t) => t.name);
			expect(names).toContain("browser_navigate");
			expect(names).toContain("browser_click");
			expect(names).toContain("browser_type");
			expect(names).toContain("browser_select");
			expect(names).toContain("browser_fill_form");
			expect(names).toContain("browser_extract_text");
			expect(names).toContain("browser_extract_all");
			expect(names).toContain("browser_extract_structured");
			expect(names).toContain("browser_wait");
			expect(names).toContain("browser_get_content");
			expect(tools).toHaveLength(10);
		});

		it("should have unique names", () => {
			const names = tools.map((t) => t.name);
			expect(new Set(names).size).toBe(names.length);
		});

		it("browser_wait should require selector or condition", async () => {
			const openTool = findTool(createSessionTools(ctx), "browser_open");
			const openResult = await openTool.execute({});
			const sessionId = (openResult.details as { sessionId: string }).sessionId;
			const waitTool = findTool(tools, "browser_wait");
			await expect(waitTool.execute({ sessionId })).rejects.toThrow(
				"browser_wait requires either selector or condition",
			);
		});

		it("browser_extract_structured should support handleId parameter", () => {
			const extractTool = findTool(tools, "browser_extract_structured");
			const params = extractTool.parameters as { properties?: Record<string, unknown> };
			expect(params.properties?.["handleId"]).toBeDefined();
		});
	});

	describe("createPageTools", () => {
		let tools: ToolDefinition[];

		beforeEach(() => {
			tools = createPageTools(ctx);
		});

		it("should create expected page tools", () => {
			const names = tools.map((t) => t.name);
			expect(names).toContain("browser_screenshot");
			expect(names).toContain("browser_evaluate");
			expect(names).toContain("browser_scroll");
			expect(names).toContain("browser_session_trace");
			expect(tools).toHaveLength(4);
		});
	});

	describe("createApprovalTools", () => {
		it("should create approval tool", async () => {
			const tools = createApprovalTools(ctx);
			expect(tools).toHaveLength(1);
			const approvalTool = tools[0];
			if (!approvalTool) {
				throw new Error("expected approval tool");
			}
			expect(approvalTool.name).toBe("browser_request_approval");

			const result = await approvalTool.execute({
				sessionId: "sess-1",
				message: "Confirm checkout?",
			});
			expect(result.details).toHaveProperty("approved");
		});

		it("should use env fallback when provider is absent", async () => {
			const previous = process.env["BROWSER_AUTO_APPROVE"];
			process.env["BROWSER_AUTO_APPROVE"] = "1";
			try {
				const tools = createApprovalTools(ctx);
				const approvalTool = tools[0];
				if (!approvalTool) throw new Error("expected approval tool");

				const result = await approvalTool.execute({
					sessionId: "sess-1",
					message: "Confirm checkout?",
				});
				expect(result.details).toHaveProperty("approved", true);
			} finally {
				if (previous === undefined) {
					delete process.env["BROWSER_AUTO_APPROVE"];
				} else {
					process.env["BROWSER_AUTO_APPROVE"] = previous;
				}
			}
		});

		it("should use configured autoApprove when provider is absent", async () => {
			const previous = process.env["BROWSER_AUTO_APPROVE"];
			process.env["BROWSER_AUTO_APPROVE"] = "0";
			try {
				const tools = createApprovalTools({
					...ctx,
					autoApprove: true,
				});
				const approvalTool = tools[0];
				if (!approvalTool) throw new Error("expected approval tool");

				const result = await approvalTool.execute({
					sessionId: "sess-1",
					message: "Confirm checkout?",
				});
				expect(result.details).toHaveProperty("approved", true);
			} finally {
				if (previous === undefined) {
					delete process.env["BROWSER_AUTO_APPROVE"];
				} else {
					process.env["BROWSER_AUTO_APPROVE"] = previous;
				}
			}
		});

		it("should defer to injected approval provider when present", async () => {
			const approvalProvider = vi.fn(
				async ({ sessionId }: { sessionId: string }) => sessionId === "sess-2",
			);
			const tools = createApprovalTools({
				...ctx,
				approvalProvider,
			});
			const approvalTool = tools[0];
			if (!approvalTool) throw new Error("expected approval tool");

			const result = await approvalTool.execute({
				sessionId: "sess-2",
				message: "Confirm checkout?",
			});
			expect(approvalProvider).toHaveBeenCalledWith({
				sessionId: "sess-2",
				message: "Confirm checkout?",
			});
			expect(result.details).toHaveProperty("approved", true);
		});

		it("should fall back to env when approval provider throws", async () => {
			const previous = process.env["BROWSER_AUTO_APPROVE"];
			process.env["BROWSER_AUTO_APPROVE"] = "1";
			try {
				const approvalProvider = vi.fn(async () => {
					throw new Error("provider unavailable");
				});
				const tools = createApprovalTools({
					...ctx,
					approvalProvider,
				});
				const approvalTool = tools[0];
				if (!approvalTool) throw new Error("expected approval tool");

				const result = await approvalTool.execute({
					sessionId: "sess-2",
					message: "Confirm checkout?",
				});
				expect(result.details).toHaveProperty("approved", true);
			} finally {
				if (previous === undefined) {
					delete process.env["BROWSER_AUTO_APPROVE"];
				} else {
					process.env["BROWSER_AUTO_APPROVE"] = previous;
				}
			}
		});

		it("should use configured autoApprove when provider throws", async () => {
			const previous = process.env["BROWSER_AUTO_APPROVE"];
			process.env["BROWSER_AUTO_APPROVE"] = "0";
			try {
				const approvalProvider = vi.fn(async () => {
					throw new Error("provider unavailable");
				});
				const tools = createApprovalTools({
					...ctx,
					autoApprove: true,
					approvalProvider,
				});
				const approvalTool = tools[0];
				if (!approvalTool) throw new Error("expected approval tool");

				const result = await approvalTool.execute({
					sessionId: "sess-2",
					message: "Confirm checkout?",
				});
				expect(result.details).toHaveProperty("approved", true);
			} finally {
				if (previous === undefined) {
					delete process.env["BROWSER_AUTO_APPROVE"];
				} else {
					process.env["BROWSER_AUTO_APPROVE"] = previous;
				}
			}
		});
	});

	describe("getSession helper", () => {
		it("should throw for unknown session", () => {
			expect(() => getSession(ctx, "nonexistent")).toThrow("session not found: nonexistent");
		});

		it("should return session from pool", () => {
			const mock = createMockSession("test-id");
			pool.getSession.mockReturnValue(mock);
			const session = getSession(ctx, "test-id");
			expect(session.id).toBe("test-id");
		});
	});

	describe("makeActionContext helper", () => {
		it("should create action context from session", () => {
			const mock = createMockSession("test-id") as unknown as Parameters<
				typeof makeActionContext
			>[1];
			const actx = makeActionContext(ctx, mock);
			expect(actx.page).toBe(mock.page);
			expect(actx.sessionId).toBe("test-id");
			expect(actx.trace).toBe(ctx.trace);
			expect(actx.logger).toBe(ctx.logger);
		});
	});

	describe("resolveLocatorParam helper", () => {
		it("should use selector directly when provided", async () => {
			const mock = createMockSession("test-id");
			const selector = await resolveLocatorParam(
				mock as unknown as Parameters<typeof resolveLocatorParam>[0],
				{
					selector: "#target",
					handleId: undefined,
				},
			);
			expect(selector).toBe("#target");
		});

		it("should resolve selector from handleId when provided", async () => {
			const mock = createMockSession("test-id");
			const selector = await resolveLocatorParam(
				mock as unknown as Parameters<typeof resolveLocatorParam>[0],
				{
					selector: undefined,
					handleId: "hdl-1",
				},
			);
			expect((selector as { type: string; selector: string }).selector).toBe("#from-handle");
		});
	});

	describe("createHandleTools", () => {
		let tools: ToolDefinition[];

		beforeEach(() => {
			tools = createHandleTools(ctx);
		});

		it("should create expected handle tools", () => {
			const names = tools.map((t) => t.name);
			expect(names).toContain("browser_register_element");
			expect(names).toContain("browser_resolve_element");
			expect(names).toContain("browser_release_element");
			expect(tools).toHaveLength(3);
		});

		it("browser_register_element should reject invalid selector payload", async () => {
			const openTool = findTool(createSessionTools(ctx), "browser_open");
			const openResult = await openTool.execute({});
			const sessionId = (openResult.details as { sessionId: string }).sessionId;
			const registerTool = findTool(tools, "browser_register_element");
			await expect(registerTool.execute({ sessionId, selector: 123 })).rejects.toThrow(
				"selector must be a CSS string, a selector strategy object, or an array of strategy objects",
			);
		});
	});

	describe("createSemanticTools", () => {
		let tools: ToolDefinition[];

		beforeEach(() => {
			tools = createSemanticTools(ctx);
		});

		it("should create expected semantic tools", () => {
			const names = tools.map((t) => t.name);
			expect(names).toContain("browser_set_field");
			expect(names).toContain("browser_submit_form");
			expect(names).toContain("browser_apply_filter");
			expect(tools).toHaveLength(3);
		});

		it("browser_apply_filter should expose mode parameter", () => {
			const applyTool = findTool(tools, "browser_apply_filter");
			const params = applyTool.parameters as { properties?: Record<string, unknown> };
			expect(params.properties?.["mode"]).toBeDefined();
		});
	});

	describe("all tools combined", () => {
		it("should have globally unique names across all tool groups", () => {
			const sessionTools = createSessionTools(ctx);
			const actionTools = createActionTools(ctx);
			const pageTools = createPageTools(ctx);
			const approvalTools = createApprovalTools(ctx);
			const handleTools = createHandleTools(ctx);
			const semanticTools = createSemanticTools(ctx);
			const allNames = [
				...sessionTools,
				...actionTools,
				...pageTools,
				...approvalTools,
				...handleTools,
				...semanticTools,
			].map((t) => t.name);
			expect(new Set(allNames).size).toBe(allNames.length);
		});

		it("should total 26 tools", () => {
			const sessionTools = createSessionTools(ctx);
			const actionTools = createActionTools(ctx);
			const pageTools = createPageTools(ctx);
			const approvalTools = createApprovalTools(ctx);
			const handleTools = createHandleTools(ctx);
			const semanticTools = createSemanticTools(ctx);
			const total =
				sessionTools.length +
				actionTools.length +
				pageTools.length +
				approvalTools.length +
				handleTools.length +
				semanticTools.length;
			expect(total).toBe(26);
		});

		it("all tool names should start with browser_", () => {
			const sessionTools = createSessionTools(ctx);
			const actionTools = createActionTools(ctx);
			const pageTools = createPageTools(ctx);
			const approvalTools = createApprovalTools(ctx);
			const handleTools = createHandleTools(ctx);
			const semanticTools = createSemanticTools(ctx);
			const allTools = [
				...sessionTools,
				...actionTools,
				...pageTools,
				...approvalTools,
				...handleTools,
				...semanticTools,
			];
			for (const tool of allTools) {
				expect(tool.name).toMatch(/^browser_/);
			}
		});
	});
});
