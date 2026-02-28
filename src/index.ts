import { createLogger } from "./observe/logger.js";
import { ActionTrace } from "./observe/trace.js";
import { BrowserPool } from "./pool/browser-pool.js";
import { loadConfiguredSitePlugins } from "./site-plugins/loader.js";
import type { SitePluginConfigEntry } from "./site-plugins/types.js";
import { ActionLog } from "./store/action-log.js";
import { ArtifactManager } from "./store/artifacts.js";
import { Store } from "./store/db.js";
import { SessionStore } from "./store/sessions.js";
import { createActionTools } from "./tools/action-tools.js";
import { createApprovalTools } from "./tools/approval-tools.js";
import type { ApprovalProvider, SkillContext } from "./tools/context.js";
import { createHandleTools } from "./tools/handle-tools.js";
import { createPageTools } from "./tools/page-tools.js";
import { createSemanticTools } from "./tools/semantic-tools.js";
import type { ToolDefinition } from "./tools/session-tools.js";
import { createSessionTools } from "./tools/session-tools.js";

export const VERSION = "0.4.3";

export interface SkillConfig {
	maxContexts?: number;
	headless?: boolean;
	dbPath?: string;
	artifactsDir?: string;
	artifactsMaxSessions?: number;
	redactSensitiveActionInput?: boolean;
	sensitiveActionInputKeys?: string[];
	redactTypedActionText?: boolean;
	approvalProvider?: ApprovalProvider;
	autoApprove?: boolean;
	sitePlugins?: SitePluginConfigEntry[];
	logLevel?: string;
	traceMaxEntriesPerSession?: number;
	traceMaxDurationSamples?: number;
}

export interface BrowserAutomationSkill {
	tools: ToolDefinition[];
	context: SkillContext;
	shutdown: () => Promise<void>;
}

async function shutdownSitePlugins(
	logger: ReturnType<typeof createLogger>,
	loadedSitePlugins: Awaited<ReturnType<typeof loadConfiguredSitePlugins>>,
): Promise<void> {
	for (const entry of loadedSitePlugins) {
		if (!entry.plugin.dispose) {
			continue;
		}
		try {
			await entry.plugin.dispose();
		} catch (err) {
			logger.warn({ module: entry.module, err }, "site plugin dispose failed");
		}
	}
}

async function snapshotActiveSessionsBeforeShutdown(
	pool: BrowserPool,
	sessions: SessionStore,
	logger: ReturnType<typeof createLogger>,
): Promise<void> {
	const activeSessions = pool.listSessions();
	for (const session of activeSessions) {
		try {
			const snapshot = await session.snapshot();
			if (!sessions.get(session.id)) {
				sessions.create(session.id, session.profile);
			}
			sessions.saveSnapshot(session.id, snapshot);
			sessions.updateStatus(session.id, "suspended");
		} catch (err) {
			logger.warn({ sessionId: session.id, err }, "failed to snapshot session during shutdown");
		}
	}
}

function enforceArtifactRetentionOnShutdown(
	artifacts: ArtifactManager,
	logger: ReturnType<typeof createLogger>,
): void {
	try {
		const removed = artifacts.enforceRetention();
		if (removed > 0) {
			logger.info({ removed }, "artifact retention enforced during shutdown");
		}
	} catch (err) {
		logger.warn({ err }, "failed to enforce artifact retention during shutdown");
	}
}

export async function createSkill(config: SkillConfig = {}): Promise<BrowserAutomationSkill> {
	const logger = createLogger("browser-automation", config.logLevel);

	const pool = new BrowserPool({
		maxContexts: config.maxContexts ?? 4,
		launchOptions: { headless: config.headless ?? true },
		logger,
	});

	const storeOpts: { logger: typeof logger; dbPath?: string } = { logger };
	if (config.dbPath) {
		storeOpts.dbPath = config.dbPath;
	}
	const store = new Store(storeOpts);
	const sessions = new SessionStore(store.db);
	const actionLogOptions = (() => {
		const options: {
			redactSensitiveInput?: boolean;
			sensitiveInputKeys?: string[];
			redactTypedText?: boolean;
		} = {};
		if (config.redactSensitiveActionInput !== undefined) {
			options.redactSensitiveInput = config.redactSensitiveActionInput;
		}
		if (config.sensitiveActionInputKeys !== undefined) {
			options.sensitiveInputKeys = config.sensitiveActionInputKeys;
		}
		if (config.redactTypedActionText !== undefined) {
			options.redactTypedText = config.redactTypedActionText;
		}
		return options;
	})();
	const actionLog = new ActionLog(store.db, actionLogOptions);
	const artifactOpts: {
		logger: typeof logger;
		baseDir?: string;
		maxSessions?: number;
	} = { logger };
	if (config.artifactsDir) {
		artifactOpts.baseDir = config.artifactsDir;
	}
	if (config.artifactsMaxSessions !== undefined) {
		artifactOpts.maxSessions = config.artifactsMaxSessions;
	}
	const artifacts = new ArtifactManager(artifactOpts);
	try {
		const startupArtifactsRemoved = artifacts.enforceRetention();
		if (startupArtifactsRemoved > 0) {
			logger.info(
				{ removed: startupArtifactsRemoved },
				"artifact retention enforced during startup",
			);
		}
	} catch (err) {
		logger.warn({ err }, "failed to enforce artifact retention during startup");
	}
	const traceOpts: {
		maxEntriesPerSession?: number;
		maxDurationSamples?: number;
	} = {};
	if (config.traceMaxEntriesPerSession !== undefined) {
		traceOpts.maxEntriesPerSession = config.traceMaxEntriesPerSession;
	}
	if (config.traceMaxDurationSamples !== undefined) {
		traceOpts.maxDurationSamples = config.traceMaxDurationSamples;
	}
	const trace = new ActionTrace(traceOpts);

	// Suspend any sessions that were active when the process last exited
	const suspended = sessions.suspendAll();
	if (suspended > 0) {
		logger.info({ count: suspended }, "suspended leftover active sessions from previous run");
	}

	const ctx: SkillContext = {
		pool,
		store,
		sessions,
		actionLog,
		artifacts,
		trace,
		logger,
	};
	if (config.approvalProvider !== undefined) {
		ctx.approvalProvider = config.approvalProvider;
	}
	if (config.autoApprove !== undefined) {
		ctx.autoApprove = config.autoApprove;
	}

	const coreTools = [
		...createSessionTools(ctx),
		...createActionTools(ctx),
		...createPageTools(ctx),
		...createApprovalTools(ctx),
		...createHandleTools(ctx),
		...createSemanticTools(ctx),
	];
	const loadedSitePlugins = await loadConfiguredSitePlugins(
		config.sitePlugins ?? [],
		ctx,
		logger,
		new Set(coreTools.map((tool) => tool.name)),
	);
	const tools = [...coreTools, ...loadedSitePlugins.flatMap((entry) => entry.tools)];

	const shutdown = async (): Promise<void> => {
		logger.info("shutting down browser automation skill");
		enforceArtifactRetentionOnShutdown(artifacts, logger);
		await snapshotActiveSessionsBeforeShutdown(pool, sessions, logger);
		sessions.suspendAll();
		await pool.shutdown();
		await shutdownSitePlugins(logger, loadedSitePlugins);
		store.close();
		trace.reset();
		logger.info("browser automation skill shut down");
	};

	logger.info(
		{ toolCount: tools.length, version: VERSION },
		"browser automation skill initialized",
	);

	return { tools, context: ctx, shutdown };
}

export type {
	ActionContext,
	ActionOptions,
	ActionResult,
	StructuredError,
	TraceMetadata,
} from "./actions/action.js";
export type { AssertionCheck } from "./actions/assertions.js";
// biome-ignore lint/performance/noBarrelFile: index.ts is the package public API surface
export {
	allOf,
	assertElementGone,
	assertElementText,
	assertElementVisible,
	assertUrlContains,
} from "./actions/assertions.js";
export type { ExtractionResult, ItemProvenance } from "./actions/extract-structured.js";
export { extractStructured } from "./actions/extract-structured.js";
export type { InputMode } from "./actions/interact.js";
export type {
	ApplyFilterOptions,
	ApplyFilterResult,
	SetFieldOptions,
	SetFieldResult,
	SubmitFormOptions,
	SubmitFormResult,
} from "./actions/semantic.js";
export { applyFilter, setField, submitForm } from "./actions/semantic.js";
export {
	AssertionFailedError,
	BrowserAutomationError,
	NavigationInterruptedError,
	SessionUnhealthyError,
	StaleElementError,
	TargetNotFoundError,
	TimeoutExceededError,
} from "./errors.js";
export type { SelectorResolutionTrace, TraceEntry, TraceStats } from "./observe/trace.js";
export type { PoolStatus } from "./pool/browser-pool.js";
export type { SelectorResolution, SelectorStrategy } from "./selectors/strategy.js";
export type { ElementHandle, HandleResolution } from "./session/handle-registry.js";
export { HandleRegistry } from "./session/handle-registry.js";
export type { CookieData, SessionSnapshot } from "./session/snapshot.js";
export type {
	LoadedSitePlugin,
	SitePlugin,
	SitePluginConfigEntry,
	SitePluginFactory,
	SitePluginMeta,
} from "./site-plugins/types.js";
export type { ApprovalProvider, ApprovalRequest, SkillContext } from "./tools/context.js";
// Re-export key types for consumers
export type { ToolDefinition, ToolResult } from "./tools/session-tools.js";
