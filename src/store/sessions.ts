import type Database from "better-sqlite3";
import type { SessionSnapshot } from "../session/snapshot.js";

export type SessionStatus = "active" | "suspended" | "closed";

export interface SessionRecord {
	id: string;
	profile: string | null;
	status: SessionStatus;
	snapshot: SessionSnapshot | null;
	createdAt: string;
	updatedAt: string;
}

interface SessionRow {
	id: string;
	profile: string | null;
	status: string;
	snapshot: string | null;
	created_at: string;
	updated_at: string;
}

function rowToRecord(row: SessionRow): SessionRecord {
	return {
		id: row.id,
		profile: row.profile,
		status: row.status as SessionStatus,
		snapshot: row.snapshot ? (JSON.parse(row.snapshot) as SessionSnapshot) : null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export class SessionStore {
	private _db: Database.Database;

	constructor(db: Database.Database) {
		this._db = db;
	}

	create(id: string, profile: string | undefined): void {
		this._db
			.prepare("INSERT INTO sessions (id, profile, status) VALUES (?, ?, 'active')")
			.run(id, profile ?? null);
	}

	get(id: string): SessionRecord | undefined {
		const row = this._db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
			| SessionRow
			| undefined;
		if (!row) {
			return undefined;
		}
		return rowToRecord(row);
	}

	updateStatus(id: string, status: SessionStatus): void {
		this._db
			.prepare("UPDATE sessions SET status = ?, updated_at = datetime('now') WHERE id = ?")
			.run(status, id);
	}

	saveSnapshot(id: string, snapshot: SessionSnapshot): void {
		this._db
			.prepare("UPDATE sessions SET snapshot = ?, updated_at = datetime('now') WHERE id = ?")
			.run(JSON.stringify(snapshot), id);
	}

	listByStatus(status: SessionStatus): SessionRecord[] {
		const rows = this._db
			.prepare("SELECT * FROM sessions WHERE status = ? ORDER BY created_at DESC")
			.all(status) as SessionRow[];
		return rows.map(rowToRecord);
	}

	listActive(): SessionRecord[] {
		return this.listByStatus("active");
	}

	listSuspended(): SessionRecord[] {
		return this.listByStatus("suspended");
	}

	suspendAll(): number {
		const result = this._db
			.prepare(
				"UPDATE sessions SET status = 'suspended', updated_at = datetime('now') WHERE status = 'active'",
			)
			.run();
		return result.changes;
	}

	closeAll(): number {
		const result = this._db
			.prepare(
				"UPDATE sessions SET status = 'closed', updated_at = datetime('now') WHERE status IN ('active', 'suspended')",
			)
			.run();
		return result.changes;
	}
}
