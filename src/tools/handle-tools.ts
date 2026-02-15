import { Type } from "@sinclair/typebox";
import type { SelectorStrategy } from "../selectors/strategy.js";
import type { SkillContext } from "./context.js";
import { getSession } from "./context.js";
import type { ToolDefinition, ToolResult } from "./session-tools.js";

function jsonResult(payload: unknown): ToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
		details: payload as Record<string, unknown>,
	};
}

function isSelectorStrategy(value: unknown): value is SelectorStrategy {
	if (!(value && typeof value === "object")) {
		return false;
	}
	const candidate = value as { type?: unknown };
	return typeof candidate.type === "string";
}

function parseSelectorParam(selector: unknown): SelectorStrategy | SelectorStrategy[] {
	if (typeof selector === "string") {
		return { type: "css", selector } as SelectorStrategy;
	}
	if (Array.isArray(selector)) {
		if (selector.length === 0) {
			throw new Error("selector strategy array cannot be empty");
		}
		if (!selector.every((entry) => isSelectorStrategy(entry))) {
			throw new Error("selector strategy array contains invalid entries");
		}
		return selector as SelectorStrategy[];
	}
	if (isSelectorStrategy(selector)) {
		return selector;
	}
	throw new Error(
		"selector must be a CSS string, a selector strategy object, or an array of strategy objects",
	);
}

export function createHandleTools(ctx: SkillContext): ToolDefinition[] {
	return [
		{
			name: "browser_register_element",
			description:
				"Register a DOM element by selector and get a stable handle ID. " +
				"The handle can be used in place of selectors in subsequent actions. " +
				"Accepts a CSS selector string or a strategy object.",
			label: "Register Element",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session ID" }),
				selector: Type.Unknown({
					description:
						"CSS selector string, or a strategy object like {type:'css',selector:'...'}, " +
						"or an array of strategy objects for fallback resolution",
				}),
			}),
			async execute(params) {
				const sessionId = params["sessionId"] as string;
				const session = getSession(ctx, sessionId);
				const selector = parseSelectorParam(params["selector"]);
				const handle = await session.handles.register(session.page, selector);
				return jsonResult({
					handleId: handle.handleId,
					strategy: handle.lastStrategy,
				});
			},
		},
		{
			name: "browser_resolve_element",
			description:
				"Check if a registered element handle is still valid by re-resolving it. " +
				"Returns resolution details including whether the element was remapped to a different strategy.",
			label: "Resolve Element",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session ID" }),
				handleId: Type.String({ description: "Handle ID to resolve" }),
			}),
			async execute(params) {
				const sessionId = params["sessionId"] as string;
				const handleId = params["handleId"] as string;
				const session = getSession(ctx, sessionId);
				const result = await session.handles.resolve(session.page, handleId);
				return jsonResult({
					valid: true,
					handleId: result.handle.handleId,
					remapped: result.remapped,
					remapCount: result.handle.remapCount,
					strategy: result.resolution.strategy,
					resolutionMs: result.resolution.resolutionMs,
				});
			},
		},
		{
			name: "browser_release_element",
			description:
				"Release a registered element handle, freeing its resources. " +
				"Use this when the element is no longer needed.",
			label: "Release Element",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session ID" }),
				handleId: Type.String({ description: "Handle ID to release" }),
			}),
			async execute(params) {
				const sessionId = params["sessionId"] as string;
				const handleId = params["handleId"] as string;
				const session = getSession(ctx, sessionId);
				const released = session.handles.release(handleId);
				return jsonResult({ ok: released, handleId });
			},
		},
	];
}
