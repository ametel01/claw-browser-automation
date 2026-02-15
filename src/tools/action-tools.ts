import { type TObject, type TProperties, Type } from "@sinclair/typebox";
import { getAll, getPageContent, getText } from "../actions/extract.js";
import { extractStructured } from "../actions/extract-structured.js";
import { click, fill, selectOption, type as typeAction } from "../actions/interact.js";
import { navigate } from "../actions/navigate.js";
import { waitForCondition, waitForSelector } from "../actions/wait.js";
import type { SkillContext } from "./context.js";
import { getSession, makeActionContext } from "./context.js";
import type { ToolDefinition, ToolResult } from "./session-tools.js";

function jsonResult(payload: unknown): ToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
		details: payload as Record<string, unknown>,
	};
}

function logAction(
	ctx: SkillContext,
	sessionId: string,
	action: string,
	result: { ok: boolean; retries: number; durationMs: number; error?: string; screenshot?: string },
	selector?: string,
	input?: Record<string, unknown>,
): void {
	const entry: Parameters<typeof ctx.actionLog.log>[0] = { sessionId, action, result };
	if (selector) {
		entry.selector = selector;
	}
	if (input) {
		entry.input = input;
	}
	ctx.actionLog.log(entry);
}

export function createActionTools(ctx: SkillContext): ToolDefinition[] {
	return [
		{
			name: "browser_navigate",
			description: "Navigate the browser to a URL and wait for the page to load",
			label: "Navigate",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session ID" }),
				url: Type.String({ description: "URL to navigate to" }),
			}),
			async execute(params) {
				const sessionId = params["sessionId"] as string;
				const url = params["url"] as string;
				const session = getSession(ctx, sessionId);
				const actx = makeActionContext(ctx, session);
				const result = await navigate(actx, url, { retries: 2 });
				logAction(ctx, sessionId, "navigate", result, undefined, { url });
				if (!result.ok) {
					throw new Error(result.error ?? "navigation failed");
				}
				return jsonResult({ ok: true, url: result.data?.url });
			},
		},
		{
			name: "browser_click",
			description: "Click an element on the page identified by a CSS selector",
			label: "Click",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session ID" }),
				selector: Type.String({ description: "CSS selector of the element to click" }),
			}),
			async execute(params) {
				const sessionId = params["sessionId"] as string;
				const selector = params["selector"] as string;
				const session = getSession(ctx, sessionId);
				const actx = makeActionContext(ctx, session);
				const result = await click(actx, selector);
				logAction(ctx, sessionId, "click", result, selector);
				if (!result.ok) {
					throw new Error(result.error ?? "click failed");
				}
				return jsonResult({ ok: true });
			},
		},
		{
			name: "browser_type",
			description:
				"Type text into an input field, clearing it first by default. " +
				"Choose a mode: fill (default), sequential (per-keystroke), paste (clipboard), " +
				"or nativeSetter (for React/Vue controlled inputs).",
			label: "Type",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session ID" }),
				selector: Type.String({ description: "CSS selector of the input field" }),
				text: Type.String({ description: "Text to type" }),
				mode: Type.Optional(
					Type.Union(
						[
							Type.Literal("fill"),
							Type.Literal("sequential"),
							Type.Literal("paste"),
							Type.Literal("nativeSetter"),
						],
						{
							description:
								"Input mode: fill (programmatic, default), sequential (per-keystroke), " +
								"paste (clipboard event), nativeSetter (React/Vue compatible value setter)",
						},
					),
				),
				sequential: Type.Optional(
					Type.Boolean({
						description: "Deprecated: use mode='sequential' instead.",
					}),
				),
				delayMs: Type.Optional(
					Type.Number({
						description: "Delay between key presses in ms when mode is sequential (default: 80)",
					}),
				),
			}),
			async execute(params) {
				const sessionId = params["sessionId"] as string;
				const selector = params["selector"] as string;
				const text = params["text"] as string;
				const mode = params["mode"] as "fill" | "sequential" | "paste" | "nativeSetter" | undefined;
				const sequential = params["sequential"] as boolean | undefined;
				const delayMs = params["delayMs"] as number | undefined;
				const session = getSession(ctx, sessionId);
				const actx = makeActionContext(ctx, session);
				const opts: Parameters<typeof typeAction>[3] = {};
				if (mode) {
					opts.mode = mode;
				} else if (sequential) {
					opts.sequential = true;
				}
				if (delayMs !== undefined) {
					opts.delayMs = delayMs;
				}
				const result = await typeAction(actx, selector, text, opts);
				logAction(ctx, sessionId, "type", result, selector, { text, mode, sequential, delayMs });
				if (!result.ok) {
					throw new Error(result.error ?? "type failed");
				}
				return jsonResult({ ok: true });
			},
		},
		{
			name: "browser_select",
			description: "Select an option from a dropdown/select element",
			label: "Select",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session ID" }),
				selector: Type.String({ description: "CSS selector of the select element" }),
				value: Type.String({ description: "Value to select" }),
			}),
			async execute(params) {
				const sessionId = params["sessionId"] as string;
				const selector = params["selector"] as string;
				const value = params["value"] as string;
				const session = getSession(ctx, sessionId);
				const actx = makeActionContext(ctx, session);
				const result = await selectOption(actx, selector, value);
				logAction(ctx, sessionId, "select", result, selector, { value });
				if (!result.ok) {
					throw new Error(result.error ?? "select failed");
				}
				return jsonResult({ ok: true, selected: result.data });
			},
		},
		{
			name: "browser_fill_form",
			description:
				"Fill multiple form fields at once. Each key is a CSS selector, each value is the text to fill.",
			label: "Fill Form",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session ID" }),
				fields: Type.Record(Type.String(), Type.String(), {
					description: "Map of CSS selectors to values",
				}),
			}),
			async execute(params) {
				const sessionId = params["sessionId"] as string;
				const fields = params["fields"] as Record<string, string>;
				const session = getSession(ctx, sessionId);
				const actx = makeActionContext(ctx, session);
				const result = await fill(actx, fields);
				logAction(ctx, sessionId, "fill_form", result, undefined, { fields });
				if (!result.ok) {
					throw new Error(result.error ?? "fill form failed");
				}
				return jsonResult({ ok: true, filled: result.data?.filled });
			},
		},
		{
			name: "browser_extract_text",
			description: "Extract the text content of an element",
			label: "Extract Text",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session ID" }),
				selector: Type.String({ description: "CSS selector of the element" }),
			}),
			async execute(params) {
				const sessionId = params["sessionId"] as string;
				const selector = params["selector"] as string;
				const session = getSession(ctx, sessionId);
				const actx = makeActionContext(ctx, session);
				const result = await getText(actx, selector);
				logAction(ctx, sessionId, "extract_text", result, selector);
				if (!result.ok) {
					throw new Error(result.error ?? "extract text failed");
				}
				return jsonResult({ text: result.data });
			},
		},
		{
			name: "browser_extract_all",
			description: "Extract data from all matching elements (useful for lists and tables)",
			label: "Extract All",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session ID" }),
				selector: Type.String({ description: "CSS selector matching multiple elements" }),
				attributes: Type.Optional(
					Type.Array(Type.String(), {
						description: "Attributes to extract (default: textContent)",
					}),
				),
			}),
			async execute(params) {
				const sessionId = params["sessionId"] as string;
				const selector = params["selector"] as string;
				const attributes = params["attributes"] as string[] | undefined;
				const session = getSession(ctx, sessionId);
				const actx = makeActionContext(ctx, session);
				const opts = attributes ? { attributes } : {};
				const result = await getAll(actx, selector, opts);
				logAction(ctx, sessionId, "extract_all", result, selector, { attributes });
				if (!result.ok) {
					throw new Error(result.error ?? "extract all failed");
				}
				return jsonResult({ items: result.data });
			},
		},
		{
			name: "browser_wait",
			description: "Wait for an element state or a page condition expression",
			label: "Wait",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session ID" }),
				selector: Type.Optional(Type.String({ description: "CSS selector to wait for" })),
				condition: Type.Optional(
					Type.String({ description: "JavaScript condition expression to evaluate repeatedly" }),
				),
				state: Type.Optional(
					Type.Union(
						[
							Type.Literal("visible"),
							Type.Literal("hidden"),
							Type.Literal("attached"),
							Type.Literal("detached"),
						],
						{ description: "State to wait for (default: visible)" },
					),
				),
			}),
			async execute(params) {
				const sessionId = params["sessionId"] as string;
				const selector = params["selector"] as string | undefined;
				const condition = params["condition"] as string | undefined;
				const state = params["state"] as "visible" | "hidden" | "attached" | "detached" | undefined;
				const session = getSession(ctx, sessionId);
				const actx = makeActionContext(ctx, session);

				if (!(selector || condition)) {
					throw new Error("browser_wait requires either selector or condition");
				}

				let result: Awaited<ReturnType<typeof waitForSelector>>;
				if (selector) {
					const waitOpts: Parameters<typeof waitForSelector>[2] = {};
					if (state) {
						waitOpts.state = state;
					}
					result = await waitForSelector(actx, selector, waitOpts);
					logAction(ctx, sessionId, "wait", result, selector, state ? { state } : {});
				} else {
					const expr = condition as string;
					result = await waitForCondition(actx, expr);
					logAction(ctx, sessionId, "wait", result, undefined, { condition: expr });
				}

				if (!result.ok) {
					throw new Error(result.error ?? "wait failed");
				}
				return jsonResult({ ok: true });
			},
		},
		{
			name: "browser_get_content",
			description: "Get the cleaned text content of the entire page (scripts and styles removed)",
			label: "Get Content",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session ID" }),
			}),
			async execute(params) {
				const sessionId = params["sessionId"] as string;
				const session = getSession(ctx, sessionId);
				const actx = makeActionContext(ctx, session);
				const result = await getPageContent(actx);
				logAction(ctx, sessionId, "get_content", result);
				if (!result.ok) {
					throw new Error(result.error ?? "get content failed");
				}
				return jsonResult({ content: result.data });
			},
		},
		{
			name: "browser_extract_structured",
			description:
				"Extract structured data from matching elements using a field mapping. " +
				"Each field name maps to an HTML attribute (or 'textContent'/'innerHTML'). " +
				"Returns typed data with provenance showing which DOM node produced each item.",
			label: "Extract Structured",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session ID" }),
				selector: Type.String({
					description: "CSS selector matching the elements to extract from",
				}),
				fields: Type.Record(Type.String(), Type.String(), {
					description:
						"Map of output field names to HTML attributes. " +
						"Use 'textContent' for text, 'innerHTML' for HTML, or any attribute name (href, src, etc.)",
				}),
				limit: Type.Optional(Type.Number({ description: "Maximum number of items to extract" })),
			}),
			async execute(params) {
				const sessionId = params["sessionId"] as string;
				const selector = params["selector"] as string;
				const fields = params["fields"] as Record<string, string>;
				const limit = params["limit"] as number | undefined;
				const session = getSession(ctx, sessionId);
				const actx = makeActionContext(ctx, session);

				const schemaProps: Record<string, ReturnType<typeof Type.String>> = {};
				for (const [key, desc] of Object.entries(fields)) {
					schemaProps[key] = Type.String({ description: desc });
				}
				const schema = Type.Object(schemaProps) as TObject<TProperties>;

				const opts = limit !== undefined ? { limit } : {};
				const result = await extractStructured(actx, selector, schema, opts);
				logAction(ctx, sessionId, "extract_structured", result, selector, { fields, limit });
				if (!result.ok) {
					throw new Error(result.error ?? "extract structured failed");
				}
				return jsonResult({
					items: result.data?.data,
					provenance: result.data?.provenance,
				});
			},
		},
	];
}
