import { Type } from "@sinclair/typebox";
import type { SkillContext } from "./context.js";
import { getSession } from "./context.js";

export interface ToolDefinition {
	name: string;
	description: string;
	label: string;
	parameters: ReturnType<typeof Type.Object>;
	execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
}

function jsonResult(payload: unknown): ToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
		details: payload as Record<string, unknown>,
	};
}

export function createSessionTools(ctx: SkillContext): ToolDefinition[] {
	return [
		{
			name: "browser_open",
			description:
				"Open a new browser session, optionally navigating to a URL and/or restoring a named profile",
			label: "Open Browser",
			parameters: Type.Object({
				url: Type.Optional(Type.String({ description: "URL to navigate to after opening" })),
				profile: Type.Optional(
					Type.String({ description: "Named profile to restore (preserves cookies/storage)" }),
				),
			}),
			async execute(params) {
				const url = params["url"] as string | undefined;
				const profile = params["profile"] as string | undefined;
				const acquireOpts: { url?: string; profile?: string } = {};
				if (url) {
					acquireOpts.url = url;
				}
				if (profile) {
					acquireOpts.profile = profile;
				}
				const session = await ctx.pool.acquire(acquireOpts);
				ctx.sessions.create(session.id, profile);
				return jsonResult({ sessionId: session.id, url: session.currentUrl() });
			},
		},
		{
			name: "browser_close",
			description: "Close a browser session and release its resources",
			label: "Close Browser",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session ID to close" }),
			}),
			async execute(params) {
				const sessionId = params["sessionId"] as string;
				const session = getSession(ctx, sessionId);
				const snapshot = await session.snapshot();
				ctx.sessions.saveSnapshot(sessionId, snapshot);
				await ctx.pool.release(session);
				ctx.sessions.updateStatus(sessionId, "closed");
				return jsonResult({ ok: true });
			},
		},
		{
			name: "browser_list",
			description: "List all active browser sessions with their current URLs and health status",
			label: "List Sessions",
			parameters: Type.Object({}),
			async execute() {
				const sessions = ctx.pool.listSessions().map((s) => ({
					sessionId: s.id,
					url: s.currentUrl(),
					healthy: s.isHealthy(),
					profile: s.profile,
				}));
				return jsonResult({ sessions });
			},
		},
		{
			name: "browser_restore",
			description: "Restore a previously suspended browser session from its saved snapshot",
			label: "Restore Session",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session ID to restore" }),
			}),
			async execute(params) {
				const sessionId = params["sessionId"] as string;
				const record = ctx.sessions.get(sessionId);
				if (!record) {
					throw new Error(`session record not found: ${sessionId}`);
				}
				if (!record.snapshot) {
					throw new Error(`no snapshot available for session: ${sessionId}`);
				}
				const restoreOpts: { profile?: string } = {};
				if (record.profile) {
					restoreOpts.profile = record.profile;
				}
				const session = await ctx.pool.acquire(restoreOpts);
				await session.restore(record.snapshot);
				ctx.sessions.updateStatus(sessionId, "closed");
				ctx.sessions.create(session.id, record.profile ?? undefined);
				return jsonResult({ ok: true, sessionId: session.id, url: session.currentUrl() });
			},
		},
		{
			name: "browser_state",
			description: "Get the current state of a browser session (URL, title, loading status)",
			label: "Page State",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session ID to inspect" }),
			}),
			async execute(params) {
				const sessionId = params["sessionId"] as string;
				const session = getSession(ctx, sessionId);
				const [title, readyState] = await Promise.all([
					session.page.title(),
					session.page.evaluate(() => document.readyState),
				]);
				return jsonResult({
					url: session.currentUrl(),
					title,
					readyState,
					isLoading: readyState !== "complete",
					healthy: session.isHealthy(),
				});
			},
		},
	];
}
