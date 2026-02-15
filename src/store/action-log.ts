import type Database from "better-sqlite3";
import type { ActionResult } from "../actions/action.js";

export interface ActionLogEntry {
	id: number;
	sessionId: string;
	action: string;
	selector: string | null;
	input: string | null;
	result: ActionResult;
	screenshotPath: string | null;
	durationMs: number;
	retries: number;
	createdAt: string;
}

interface ActionLogRow {
	id: number;
	session_id: string;
	action: string;
	selector: string | null;
	input: string | null;
	result: string;
	screenshot_path: string | null;
	duration_ms: number;
	retries: number;
	created_at: string;
}

function rowToEntry(row: ActionLogRow): ActionLogEntry {
	return {
		id: row.id,
		sessionId: row.session_id,
		action: row.action,
		selector: row.selector,
		input: row.input,
		result: JSON.parse(row.result) as ActionResult,
		screenshotPath: row.screenshot_path,
		durationMs: row.duration_ms,
		retries: row.retries,
		createdAt: row.created_at,
	};
}

export interface LogActionParams {
	sessionId: string;
	action: string;
	selector?: string;
	input?: Record<string, unknown>;
	result: ActionResult;
}

export class ActionLog {
	private _db: Database.Database;

	constructor(db: Database.Database) {
		this._db = db;
	}

	log(params: LogActionParams): number {
		const result = this._db
			.prepare(
				`INSERT INTO action_log (session_id, action, selector, input, result, screenshot_path, duration_ms, retries)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				params.sessionId,
				params.action,
				params.selector ?? null,
				params.input ? JSON.stringify(params.input) : null,
				JSON.stringify(params.result),
				params.result.screenshot ?? null,
				params.result.durationMs,
				params.result.retries,
			);
		return Number(result.lastInsertRowid);
	}

	getBySession(sessionId: string, limit = 100): ActionLogEntry[] {
		const rows = this._db
			.prepare("SELECT * FROM action_log WHERE session_id = ? ORDER BY id DESC LIMIT ?")
			.all(sessionId, limit) as ActionLogRow[];
		return rows.map(rowToEntry);
	}

	getRecent(limit = 50): ActionLogEntry[] {
		const rows = this._db
			.prepare("SELECT * FROM action_log ORDER BY id DESC LIMIT ?")
			.all(limit) as ActionLogRow[];
		return rows.map(rowToEntry);
	}

	countBySession(sessionId: string): number {
		const row = this._db
			.prepare("SELECT COUNT(*) as count FROM action_log WHERE session_id = ?")
			.get(sessionId) as { count: number };
		return row.count;
	}

	getFailures(sessionId: string): ActionLogEntry[] {
		const rows = this._db
			.prepare(
				"SELECT * FROM action_log WHERE session_id = ? AND json_extract(result, '$.ok') = 0 ORDER BY id DESC",
			)
			.all(sessionId) as ActionLogRow[];
		return rows.map(rowToEntry);
	}
}
