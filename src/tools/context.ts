import type { ActionContext } from "../actions/action.js";
import type { Logger } from "../observe/logger.js";
import type { ActionTrace } from "../observe/trace.js";
import type { BrowserPool } from "../pool/browser-pool.js";
import type { BrowserSession } from "../session/session.js";
import type { ActionLog } from "../store/action-log.js";
import type { ArtifactManager } from "../store/artifacts.js";
import type { Store } from "../store/db.js";
import type { SessionStore } from "../store/sessions.js";

export interface SkillContext {
	pool: BrowserPool;
	store: Store;
	sessions: SessionStore;
	actionLog: ActionLog;
	artifacts: ArtifactManager;
	trace: ActionTrace;
	logger: Logger;
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
