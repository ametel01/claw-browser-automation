import { Type } from "@sinclair/typebox";
import type { ScrollDirection } from "../actions/page.js";
import { evaluate, screenshot, scroll } from "../actions/page.js";
import type { SkillContext } from "./context.js";
import { getSession, makeActionContext } from "./context.js";
import type { ToolDefinition, ToolResult } from "./session-tools.js";

function jsonResult(payload: unknown): ToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
		details: payload as Record<string, unknown>,
	};
}

export function createPageTools(ctx: SkillContext): ToolDefinition[] {
	return [
		{
			name: "browser_screenshot",
			description: "Take a screenshot of the current page and save it as an artifact",
			label: "Screenshot",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session ID" }),
				label: Type.Optional(Type.String({ description: "Label for the screenshot file" })),
				fullPage: Type.Optional(
					Type.Boolean({ description: "Capture the full scrollable page (default: false)" }),
				),
			}),
			async execute(params) {
				const sessionId = params["sessionId"] as string;
				const label = params["label"] as string | undefined;
				const fullPage = params["fullPage"] as boolean | undefined;
				const session = getSession(ctx, sessionId);
				const actx = makeActionContext(ctx, session);
				const opts: Record<string, unknown> = { retries: 1 };
				if (label) {
					opts["label"] = label;
				}
				if (fullPage !== undefined) {
					opts["fullPage"] = fullPage;
				}
				const result = await screenshot(actx, opts as Parameters<typeof screenshot>[1]);
				if (!result.ok) {
					throw new Error(result.error ?? "screenshot failed");
				}

				try {
					const removed = ctx.artifacts.enforceRetention();
					if (removed > 0) {
						ctx.logger.debug({ removed }, "artifact retention enforced after screenshot");
					}
				} catch (err) {
					ctx.logger.warn({ err }, "failed to enforce artifact retention after screenshot");
				}
				return jsonResult({ path: result.data });
			},
		},
		{
			name: "browser_evaluate",
			description: "Execute JavaScript in the page context and return the result",
			label: "Evaluate JS",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session ID" }),
				script: Type.String({ description: "JavaScript code to evaluate in the page" }),
			}),
			async execute(params) {
				const sessionId = params["sessionId"] as string;
				const script = params["script"] as string;
				const session = getSession(ctx, sessionId);
				const actx = makeActionContext(ctx, session);
				const result = await evaluate(actx, script, { retries: 1 });
				ctx.actionLog.log({
					sessionId,
					action: "evaluate",
					input: { script },
					result,
				});
				if (!result.ok) {
					throw new Error(result.error ?? "evaluate failed");
				}
				return jsonResult({ result: result.data });
			},
		},
		{
			name: "browser_scroll",
			description: "Scroll the page in a given direction",
			label: "Scroll",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session ID" }),
				direction: Type.Union(
					[Type.Literal("up"), Type.Literal("down"), Type.Literal("left"), Type.Literal("right")],
					{ description: "Direction to scroll" },
				),
				amount: Type.Optional(Type.Number({ description: "Pixels to scroll (default: 500)" })),
			}),
			async execute(params) {
				const sessionId = params["sessionId"] as string;
				const direction = params["direction"] as ScrollDirection;
				const amount = params["amount"] as number | undefined;
				const session = getSession(ctx, sessionId);
				const actx = makeActionContext(ctx, session);
				const opts: Record<string, unknown> = { retries: 1 };
				if (amount !== undefined) {
					opts["amount"] = amount;
				}
				const result = await scroll(actx, direction, opts as Parameters<typeof scroll>[2]);
				if (!result.ok) {
					throw new Error(result.error ?? "scroll failed");
				}
				return jsonResult({ ok: true });
			},
		},
		{
			name: "browser_session_trace",
			description: "Get the action trace for a session — shows what happened and in what order",
			label: "Session Trace",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session ID" }),
			}),
			async execute(params) {
				const sessionId = params["sessionId"] as string;
				const summary = ctx.trace.getSessionSummary(sessionId);
				const entries = ctx.trace.getSessionTrace(sessionId);
				return jsonResult({ summary, entries, count: entries.length });
			},
		},
	];
}
