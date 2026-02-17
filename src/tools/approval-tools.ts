import { Type } from "@sinclair/typebox";
import type { SkillContext } from "./context.js";
import type { ToolDefinition, ToolResult } from "./session-tools.js";

function getEnvApproval(): boolean {
	return process.env["BROWSER_AUTO_APPROVE"] === "1";
}

function resolveFallbackApproval(ctx: SkillContext): boolean {
	if (ctx.autoApprove !== undefined) {
		return ctx.autoApprove;
	}
	return getEnvApproval();
}

function jsonResult(payload: unknown): ToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
		details: payload as Record<string, unknown>,
	};
}

export function createApprovalTools(ctx: SkillContext): ToolDefinition[] {
	return [
		{
			name: "browser_request_approval",
			description:
				"Request human approval before irreversible browser actions. Returns approval decision.",
			label: "Request Approval",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session ID requiring approval" }),
				message: Type.String({ description: "Approval prompt for the human reviewer" }),
			}),
			async execute(params) {
				const sessionId = params["sessionId"] as string;
				const message = params["message"] as string;
				const provider = ctx.approvalProvider;
				const approvalRequest = { sessionId, message };
				const approved = await (async () => {
					if (!provider) {
						return resolveFallbackApproval(ctx);
					}
					try {
						const providerDecision = await provider(approvalRequest);
						if (typeof providerDecision === "boolean") {
							return providerDecision;
						}
						ctx.logger.warn(
							{
								sessionId,
								message,
								providerDecisionType: typeof providerDecision,
							},
							"approval provider returned non-boolean; falling back to env",
						);
						return resolveFallbackApproval(ctx);
					} catch (err) {
						ctx.logger.warn(
							{ err, sessionId, message },
							"approval provider threw; falling back to env",
						);
						return resolveFallbackApproval(ctx);
					}
				})();
				ctx.logger.warn({ sessionId, message, approved }, "approval requested");
				return jsonResult({ approved, message });
			},
		},
	];
}
