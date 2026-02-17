import type { AnyAgentTool, OpenClawPluginApi, OpenClawPluginService } from "openclaw/plugin-sdk";
import { type BrowserAutomationSkill, createSkill, type SkillConfig } from "./index.js";
import type { ToolDefinition } from "./tools/session-tools.js";

/** Maps `api.pluginConfig` keys to our `SkillConfig`. */
function resolveConfig(raw: Record<string, unknown> | undefined): SkillConfig {
	if (!raw) return {};
	const cfg: SkillConfig = {};
	if (typeof raw["maxContexts"] === "number") cfg.maxContexts = raw["maxContexts"];
	if (typeof raw["headless"] === "boolean") cfg.headless = raw["headless"];
	if (typeof raw["dbPath"] === "string") cfg.dbPath = raw["dbPath"];
	if (typeof raw["artifactsDir"] === "string") cfg.artifactsDir = raw["artifactsDir"];
	if (typeof raw["artifactsMaxSessions"] === "number")
		cfg.artifactsMaxSessions = raw["artifactsMaxSessions"];
	if (typeof raw["redactSensitiveActionInput"] === "boolean")
		cfg.redactSensitiveActionInput = raw["redactSensitiveActionInput"];
	if (Array.isArray(raw["sensitiveActionInputKeys"])) {
		cfg.sensitiveActionInputKeys = raw["sensitiveActionInputKeys"].filter(
			(value): value is string => typeof value === "string",
		);
	}
	if (typeof raw["redactTypedActionText"] === "boolean")
		cfg.redactTypedActionText = raw["redactTypedActionText"];
	if (typeof raw["logLevel"] === "string") cfg.logLevel = raw["logLevel"];
	return cfg;
}

/** Wraps our `ToolDefinition` into an OpenClaw `AgentTool`. */
function adaptTool(tool: ToolDefinition): AnyAgentTool {
	return {
		name: tool.name,
		description: tool.description,
		label: tool.label,
		parameters: tool.parameters,
		execute: (
			_toolCallId: string,
			params: Record<string, unknown>,
			_signal?: AbortSignal,
			_onUpdate?: unknown,
		) => tool.execute(params),
	} as AnyAgentTool;
}

const plugin = {
	id: "claw-browser-automation",
	name: "Browser Automation",
	description: "Reliable browser automation layer for OpenClaw using Playwright",

	async register(api: OpenClawPluginApi): Promise<void> {
		const config = resolveConfig(api.pluginConfig);
		let skill: BrowserAutomationSkill | undefined;

		const service: OpenClawPluginService = {
			id: "claw-browser-automation",
			async start() {
				skill = await createSkill(config);
				api.logger.info(`browser-automation started (${skill.tools.length} tools)`);
			},
			async stop() {
				if (skill) {
					await skill.shutdown();
					skill = undefined;
					api.logger.info("browser-automation stopped");
				}
			},
		};
		api.registerService(service);

		// Register tools as a factory — OpenClaw calls it when an agent session needs tools
		api.registerTool(() => {
			if (!skill) return null;
			return skill.tools.map(adaptTool);
		});
	},
};

export default plugin;
