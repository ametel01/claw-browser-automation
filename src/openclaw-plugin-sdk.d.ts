/**
 * Minimal type declarations for the OpenClaw plugin SDK.
 *
 * The full SDK ships with `openclaw` (a peer dependency), but since it's
 * installed globally we declare only the surface we need so `tsc` can
 * verify the plugin adapter without pulling in the entire package.
 */
declare module "openclaw/plugin-sdk" {
	import type { TSchema } from "@sinclair/typebox";

	/* ── Agent tools ────────────────────────────────────────────── */

	interface AgentToolResult<T = unknown> {
		content: Array<{ type: "text"; text: string }>;
		details: T;
	}

	type AgentToolUpdateCallback<T = unknown> = (partialResult: AgentToolResult<T>) => void;

	interface AnyAgentTool {
		name: string;
		description: string;
		label: string;
		parameters: TSchema;
		execute: (
			toolCallId: string,
			params: Record<string, unknown>,
			signal?: AbortSignal,
			onUpdate?: AgentToolUpdateCallback,
		) => Promise<AgentToolResult>;
	}

	/* ── Plugin API ─────────────────────────────────────────────── */

	interface PluginLogger {
		debug?: (message: string) => void;
		info: (message: string) => void;
		warn: (message: string) => void;
		error: (message: string) => void;
	}

	interface OpenClawPluginServiceContext {
		config: Record<string, unknown>;
		workspaceDir?: string;
		stateDir: string;
		logger: PluginLogger;
	}

	interface OpenClawPluginService {
		id: string;
		start: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
		stop?: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
	}

	type OpenClawPluginToolFactory = (ctx: {
		config?: Record<string, unknown>;
		workspaceDir?: string;
		agentDir?: string;
		agentId?: string;
		sessionKey?: string;
		messageChannel?: string;
		agentAccountId?: string;
		sandboxed?: boolean;
	}) => AnyAgentTool | AnyAgentTool[] | null | undefined;

	interface OpenClawPluginApi {
		id: string;
		name: string;
		pluginConfig?: Record<string, unknown>;
		logger: PluginLogger;
		registerTool: (
			tool: AnyAgentTool | OpenClawPluginToolFactory,
			opts?: { name?: string; names?: string[]; optional?: boolean },
		) => void;
		registerService: (service: OpenClawPluginService) => void;
	}
}
