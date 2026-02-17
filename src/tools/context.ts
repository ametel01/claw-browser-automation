import type { ActionContext } from "../actions/action.js";
import type { Logger } from "../observe/logger.js";
import type { ActionTrace } from "../observe/trace.js";
import type { BrowserPool } from "../pool/browser-pool.js";
import type { Selector } from "../selectors/strategy.js";
import type { BrowserSession } from "../session/session.js";
import type { ActionLog } from "../store/action-log.js";
import type { ArtifactManager } from "../store/artifacts.js";
import type { Store } from "../store/db.js";
import type { SessionStore } from "../store/sessions.js";

export interface ApprovalRequest {
	sessionId: string;
	message: string;
}

export type ApprovalProvider = (request: ApprovalRequest) => boolean | Promise<boolean>;

export interface SkillContext {
	pool: BrowserPool;
	store: Store;
	sessions: SessionStore;
	actionLog: ActionLog;
	artifacts: ArtifactManager;
	trace: ActionTrace;
	logger: Logger;
	approvalProvider?: ApprovalProvider;
	autoApprove?: boolean;
}

export function getSession(ctx: SkillContext, sessionId: string): BrowserSession {
	const session = ctx.pool.getSession(sessionId);
	if (!session) {
		throw new Error(`session not found: ${sessionId}`);
	}
	return session;
}

export function makeActionContext(ctx: SkillContext, session: BrowserSession): ActionContext {
	return {
		page: session.page,
		logger: ctx.logger,
		screenshotDir: ctx.artifacts.sessionDir(session.id),
		sessionId: session.id,
		trace: ctx.trace,
	};
}

/**
 * Resolve a tool parameter that may be either a CSS selector string or a handle ID.
 * When handleId is provided, resolves the handle to its locator's selector.
 * Returns the selector to pass to action functions.
 */
export async function resolveLocatorParam(
	session: BrowserSession,
	params: { selector: string | undefined; handleId: string | undefined },
): Promise<Selector> {
	if (params.handleId) {
		const resolution = await session.handles.resolve(session.page, params.handleId);
		return resolution.handle.selector;
	}
	if (params.selector) {
		return params.selector;
	}
	throw new Error("either selector or handleId is required");
}
