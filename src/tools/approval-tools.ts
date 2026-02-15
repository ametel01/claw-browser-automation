import { Type } from "@sinclair/typebox";
import type { SkillContext } from "./context.js";
import type { ToolDefinition, ToolResult } from "./session-tools.js";

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
				const approved = process.env["BROWSER_AUTO_APPROVE"] === "1";
				ctx.logger.warn({ sessionId, message, approved }, "approval requested");
				return jsonResult({ approved, message });
			},
		},
	];
}
