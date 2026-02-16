import { Type } from "@sinclair/typebox";
import { applyFilter, setField, submitForm } from "../actions/semantic.js";
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
	input?: Record<string, unknown>,
): void {
	const entry: Parameters<typeof ctx.actionLog.log>[0] = { sessionId, action, result };
	if (input) {
		entry.input = input;
	}
	ctx.actionLog.log(entry);
}

export function createSemanticTools(ctx: SkillContext): ToolDefinition[] {
	return [
		{
			name: "browser_set_field",
			description:
				"Set a form field by its label, placeholder, name, or aria-label. " +
				"Automatically finds the matching input using a fallback strategy chain. " +
				"Supports all input modes (fill, sequential, paste, nativeSetter).",
			label: "Set Field",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session ID" }),
				identifier: Type.String({
					description: "The field label, placeholder text, name attribute, or aria-label to match",
				}),
				value: Type.String({ description: "Value to fill into the field" }),
				mode: Type.Optional(
					Type.Union(
						[
							Type.Literal("fill"),
							Type.Literal("sequential"),
							Type.Literal("paste"),
							Type.Literal("nativeSetter"),
						],
						{ description: "Input mode (default: fill)" },
					),
				),
				scope: Type.Optional(
					Type.String({
						description: "CSS selector to scope the field search within a container",
					}),
				),
			}),
			async execute(params) {
				const sessionId = params["sessionId"] as string;
				const identifier = params["identifier"] as string;
				const value = params["value"] as string;
				const mode = params["mode"] as "fill" | "sequential" | "paste" | "nativeSetter" | undefined;
				const scope = params["scope"] as string | undefined;
				const session = getSession(ctx, sessionId);
				const actx = makeActionContext(ctx, session);
				const opts: Parameters<typeof setField>[3] = {};
				if (mode) {
					opts.mode = mode;
				}
				if (scope) {
					opts.scope = scope;
				}
				const result = await setField(actx, identifier, value, opts);
				logAction(ctx, sessionId, "set_field", result, { identifier, value, mode, scope });
				if (!result.ok) {
					throw new Error(result.error ?? "set field failed");
				}
				return jsonResult({
					ok: true,
					strategy: result.data?.strategy,
					identifier,
				});
			},
		},
		{
			name: "browser_submit_form",
			description:
				"Find and click the submit button within a form. " +
				"Searches for button[type=submit], input[type=submit], " +
				"aria role button named 'Submit', or the default button.",
			label: "Submit Form",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session ID" }),
				scope: Type.Optional(
					Type.String({
						description: "CSS selector to scope the search to a specific form",
					}),
				),
			}),
			async execute(params) {
				const sessionId = params["sessionId"] as string;
				const scope = params["scope"] as string | undefined;
				const session = getSession(ctx, sessionId);
				const actx = makeActionContext(ctx, session);
				const opts: Parameters<typeof submitForm>[1] = {};
				if (scope) {
					opts.scope = scope;
				}
				const result = await submitForm(actx, opts);
				logAction(ctx, sessionId, "submit_form", result, { scope });
				if (!result.ok) {
					throw new Error(result.error ?? "submit form failed");
				}
				return jsonResult({
					ok: true,
					strategy: result.data?.strategy,
				});
			},
		},
		{
			name: "browser_apply_filter",
			description:
				"Set a filter/search field and click the apply button. " +
				"Finds the field by label/placeholder/name, fills the value, " +
				"then clicks Apply/Search/Filter or a custom button.",
			label: "Apply Filter",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session ID" }),
				identifier: Type.String({
					description: "The filter field label, placeholder, or name to match",
				}),
				value: Type.String({ description: "Filter value to set" }),
				mode: Type.Optional(
					Type.Union(
						[
							Type.Literal("fill"),
							Type.Literal("sequential"),
							Type.Literal("paste"),
							Type.Literal("nativeSetter"),
						],
						{ description: "Input mode for setting the field (default: fill)" },
					),
				),
				applySelector: Type.Optional(
					Type.String({
						description:
							"CSS selector for the apply/search button. " +
							"If omitted, searches for Submit/Apply/Search/Filter buttons.",
					}),
				),
				skipApply: Type.Optional(
					Type.Boolean({
						description: "Skip clicking the apply button (just fill the field)",
					}),
				),
				scope: Type.Optional(
					Type.String({
						description: "CSS selector to scope the search within a container",
					}),
				),
			}),
			async execute(params) {
				const sessionId = params["sessionId"] as string;
				const identifier = params["identifier"] as string;
				const value = params["value"] as string;
				const mode = params["mode"] as "fill" | "sequential" | "paste" | "nativeSetter" | undefined;
				const applySelector = params["applySelector"] as string | undefined;
				const skipApply = params["skipApply"] as boolean | undefined;
				const scope = params["scope"] as string | undefined;
				const session = getSession(ctx, sessionId);
				const actx = makeActionContext(ctx, session);
				const opts: Parameters<typeof applyFilter>[3] = {};
				if (mode) {
					opts.mode = mode;
				}
				if (applySelector) {
					opts.applySelector = applySelector;
				}
				if (skipApply) {
					opts.skipApply = skipApply;
				}
				if (scope) {
					opts.scope = scope;
				}
				const result = await applyFilter(actx, identifier, value, opts);
				logAction(ctx, sessionId, "apply_filter", result, {
					identifier,
					value,
					mode,
					applySelector,
					skipApply,
					scope,
				});
				if (!result.ok) {
					throw new Error(result.error ?? "apply filter failed");
				}
				return jsonResult({
					ok: true,
					fieldStrategy: result.data?.fieldStrategy,
					applied: result.data?.applied,
				});
			},
		},
	];
}
