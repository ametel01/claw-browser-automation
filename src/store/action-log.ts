import type Database from "better-sqlite3";
import type { ActionResult } from "../actions/action.js";

const DEFAULT_SENSITIVE_KEYS = new Set([
	"password",
	"passwd",
	"pass",
	"token",
	"auth",
	"authorization",
	"secret",
	"api_key",
	"apikey",
	"secret_key",
	"private_key",
	"access_token",
	"refresh_token",
	"client_secret",
	"id_token",
	"bearer",
	"session_id",
	"credit_card",
	"card_number",
	"cvv",
	"ssn",
	"pin",
]);

const TYPED_TEXT_KEYS = new Set(["text", "value", "fields", "script"]);

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

export interface ActionLogOptions {
	redactSensitiveInput?: boolean;
	sensitiveInputKeys?: string[];
	redactTypedText?: boolean;
}

export class ActionLog {
	private _db: Database.Database;
	private _redactSensitiveInput: boolean;
	private _redactTypedText: boolean;
	private _sensitiveInputKeys: Set<string>;

	constructor(db: Database.Database, options: ActionLogOptions = {}) {
		this._db = db;
		this._redactSensitiveInput = options.redactSensitiveInput ?? true;
		this._redactTypedText = options.redactTypedText ?? false;
		const keys = options.sensitiveInputKeys
			? [...DEFAULT_SENSITIVE_KEYS, ...options.sensitiveInputKeys]
			: [...DEFAULT_SENSITIVE_KEYS];
		this._sensitiveInputKeys = new Set(keys.map((key) => key.toLowerCase()));
	}

	private static isPlainObject(value: unknown): value is Record<string, unknown> {
		return (
			typeof value === "object" &&
			value !== null &&
			!Array.isArray(value) &&
			Object.getPrototypeOf(value) === Object.prototype
		);
	}

	private isSensitiveKey(key: string): boolean {
		return this._sensitiveInputKeys.has(key.toLowerCase());
	}

	private isTypedTextKey(key: string): boolean {
		return TYPED_TEXT_KEYS.has(key.toLowerCase());
	}

	private sanitizeInput(
		input: Record<string, unknown>,
		parentTypedText = false,
	): Record<string, unknown> {
		const safeInput: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(input)) {
			safeInput[key] = this.sanitizeValue(value, key, parentTypedText);
		}
		return safeInput;
	}

	private sanitizeValue(value: unknown, key: string, parentTypedText: boolean): unknown {
		const typedText = parentTypedText || this.isTypedTextKey(key);

		if (this._redactSensitiveInput && this.isSensitiveKey(key)) {
			return "[REDACTED]";
		}

		if (typeof value === "string") {
			if (this._redactTypedText && (typedText || this.isTypedTextKey(key))) {
				return "[REDACTED]";
			}
			return value;
		}

		if (value === null || typeof value !== "object") {
			return value;
		}

		if (Array.isArray(value)) {
			return value.map((entry) => this.sanitizeValue(entry, key, typedText || parentTypedText));
		}

		if (!ActionLog.isPlainObject(value)) {
			return value;
		}

		const childTypedText = typedText || parentTypedText;
		return this.sanitizeInput(value, childTypedText);
	}

	private serializeInput(input?: Record<string, unknown>): string | null {
		if (!input) {
			return null;
		}
		return JSON.stringify(this.sanitizeInput(input));
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
				this.serializeInput(params.input),
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
