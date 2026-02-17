import type { Logger } from "../observe/logger.js";
import type { SkillContext } from "../tools/context.js";
import type { ToolDefinition } from "../tools/session-tools.js";

export interface SitePluginMeta {
	id: string;
	version: string;
	apiVersion?: string;
	domains?: string[];
}

export interface SitePlugin {
	meta: SitePluginMeta;
	createTools: (ctx: SkillContext) => ToolDefinition[];
	matches?: (url: string) => boolean;
	dispose?: () => Promise<void> | void;
}

export type SitePluginFactory = (
	options?: Record<string, unknown>,
	logger?: Logger,
) => Promise<SitePlugin> | SitePlugin;

export interface SitePluginConfigEntry {
	module: string;
	enabled?: boolean;
	options?: Record<string, unknown>;
}

export interface LoadedSitePlugin {
	plugin: SitePlugin;
	tools: ToolDefinition[];
	module: string;
}
