import type { Logger } from "../observe/logger.js";
import type { SkillContext } from "../tools/context.js";
import type { ToolDefinition } from "../tools/session-tools.js";
import type {
	LoadedSitePlugin,
	SitePlugin,
	SitePluginConfigEntry,
	SitePluginFactory,
} from "./types.js";

interface SitePluginModuleShape {
	default?: unknown;
	createSitePlugin?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}

function isSitePlugin(value: unknown): value is SitePlugin {
	if (!isPlainObject(value)) {
		return false;
	}
	const meta = value["meta"];
	const createTools = value["createTools"];
	if (!isPlainObject(meta)) {
		return false;
	}
	return typeof meta["id"] === "string" && typeof createTools === "function";
}

function normalizeToolName(pluginId: string, toolName: string): string {
	const prefix = `${pluginId}_`;
	if (toolName.startsWith(prefix)) {
		return toolName;
	}
	return `${prefix}${toolName}`;
}

function namespaceTools(plugin: SitePlugin, tools: ToolDefinition[]): ToolDefinition[] {
	return tools.map((tool) => ({
		...tool,
		name: normalizeToolName(plugin.meta.id, tool.name),
	}));
}

async function resolvePluginFromModule(
	moduleName: string,
	options: Record<string, unknown> | undefined,
	logger: Logger,
): Promise<SitePlugin> {
	const imported = (await import(moduleName)) as SitePluginModuleShape;
	const candidate = imported.default ?? imported.createSitePlugin;

	if (isSitePlugin(candidate)) {
		return candidate;
	}

	if (typeof candidate === "function") {
		const plugin = await (candidate as SitePluginFactory)(options, logger);
		if (isSitePlugin(plugin)) {
			return plugin;
		}
		throw new Error(`site plugin factory did not return a valid plugin: ${moduleName}`);
	}

	throw new Error(
		`site plugin module must export default SitePlugin or createSitePlugin(options): ${moduleName}`,
	);
}

export async function loadConfiguredSitePlugins(
	entries: SitePluginConfigEntry[],
	ctx: SkillContext,
	logger: Logger,
	reservedToolNames: Set<string>,
): Promise<LoadedSitePlugin[]> {
	const loaded: LoadedSitePlugin[] = [];
	const toolNames = new Set(reservedToolNames);

	for (const entry of entries) {
		if (entry.enabled === false) {
			continue;
		}

		const plugin = await resolvePluginFromModule(entry.module, entry.options, logger);
		const pluginId = plugin.meta.id.trim();
		if (!pluginId) {
			throw new Error(`site plugin id must be non-empty: ${entry.module}`);
		}

		const tools = namespaceTools(plugin, plugin.createTools(ctx));
		for (const tool of tools) {
			if (toolNames.has(tool.name)) {
				throw new Error(
					`site plugin tool name collision for "${tool.name}" in module "${entry.module}"`,
				);
			}
			toolNames.add(tool.name);
		}

		logger.info(
			{ module: entry.module, pluginId: plugin.meta.id, toolCount: tools.length },
			"site plugin loaded",
		);
		loaded.push({ plugin, tools, module: entry.module });
	}

	return loaded;
}
