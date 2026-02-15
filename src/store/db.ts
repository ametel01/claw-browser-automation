import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import Database from "better-sqlite3";
import type { Logger } from "../observe/logger.js";
import { createLogger } from "../observe/logger.js";

const DEFAULT_DB_PATH = path.join(os.homedir(), ".openclaw", "browser-automation", "store.db");

const SCHEMA_VERSION = 1;

const MIGRATIONS: Record<number, string[]> = {
	1: [
		`CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			profile TEXT,
			status TEXT NOT NULL DEFAULT 'active',
			snapshot TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		)`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_profile ON sessions(profile)`,
		`CREATE TABLE IF NOT EXISTS action_log (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL REFERENCES sessions(id),
			action TEXT NOT NULL,
			selector TEXT,
			input TEXT,
			result TEXT,
			screenshot_path TEXT,
			duration_ms INTEGER,
			retries INTEGER DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		)`,
		`CREATE INDEX IF NOT EXISTS idx_action_log_session ON action_log(session_id)`,
		`CREATE TABLE IF NOT EXISTS schema_version (
			version INTEGER NOT NULL
		)`,
	],
};

export interface StoreOptions {
	dbPath?: string;
	logger?: Logger;
}

export class Store {
	private _db: Database.Database;
	private _log: Logger;

	constructor(opts: StoreOptions = {}) {
		const dbPath = opts.dbPath ?? process.env["BROWSER_STORE_PATH"] ?? DEFAULT_DB_PATH;
		this._log = opts.logger ?? createLogger("store");

		const dir = path.dirname(dbPath);
		fs.mkdirSync(dir, { recursive: true });

		this._db = new Database(dbPath);
		this._db.pragma("journal_mode = WAL");
		this._db.pragma("foreign_keys = ON");

		this._migrate();
		this._log.info({ dbPath }, "store initialized");
	}

	get db(): Database.Database {
		return this._db;
	}

	close(): void {
		this._db.close();
		this._log.info("store closed");
	}

	private _migrate(): void {
		const currentVersion = this._getCurrentVersion();

		if (currentVersion >= SCHEMA_VERSION) {
			return;
		}

		this._log.info({ from: currentVersion, to: SCHEMA_VERSION }, "running database migrations");

		const runMigrations = this._db.transaction(() => {
			for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
				const statements = MIGRATIONS[v];
				if (!statements) {
					throw new Error(`missing migration for version ${v}`);
				}
				for (const sql of statements) {
					this._db.exec(sql);
				}
				this._log.info({ version: v }, "migration applied");
			}

			this._db.exec("DELETE FROM schema_version");
			this._db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
		});

		runMigrations();
	}

	private _getCurrentVersion(): number {
		try {
			const row = this._db.prepare("SELECT version FROM schema_version LIMIT 1").get() as
				| { version: number }
				| undefined;
			return row?.version ?? 0;
		} catch {
			return 0;
		}
	}
}
