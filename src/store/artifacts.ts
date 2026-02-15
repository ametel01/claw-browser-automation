import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Logger } from "../observe/logger.js";
import { createLogger } from "../observe/logger.js";

const DEFAULT_ARTIFACTS_DIR = path.join(
	os.homedir(),
	".openclaw",
	"workspace",
	"browser-automation",
	"artifacts",
);

const DEFAULT_MAX_SESSIONS = 100;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface ArtifactManagerOptions {
	baseDir?: string;
	maxSessions?: number;
	logger?: Logger;
}

export class ArtifactManager {
	private _baseDir: string;
	private _maxSessions: number;
	private _log: Logger;

	constructor(opts: ArtifactManagerOptions = {}) {
		this._baseDir = opts.baseDir ?? process.env["BROWSER_ARTIFACTS_DIR"] ?? DEFAULT_ARTIFACTS_DIR;
		this._maxSessions = opts.maxSessions ?? DEFAULT_MAX_SESSIONS;
		this._log = opts.logger ?? createLogger("artifacts");
		fs.mkdirSync(this._baseDir, { recursive: true });
	}

	get baseDir(): string {
		return this._baseDir;
	}

	private _resolveSessionDir(sessionId: string): string {
		if (!SESSION_ID_PATTERN.test(sessionId)) {
			throw new Error(
				`invalid session id "${sessionId}": only letters, numbers, underscore, and hyphen are allowed`,
			);
		}
		const base = path.resolve(this._baseDir);
		const resolved = path.resolve(base, sessionId);
		if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
			throw new Error(`session artifacts path escapes base directory: ${sessionId}`);
		}
		return resolved;
	}

	sessionDir(sessionId: string): string {
		const dir = this._resolveSessionDir(sessionId);
		fs.mkdirSync(dir, { recursive: true });
		return dir;
	}

	async saveScreenshot(
		sessionId: string,
		buffer: Buffer,
		action: string,
		label?: string,
	): Promise<string> {
		const dir = this.sessionDir(sessionId);
		const suffix = label ? `${action}-${label}` : action;
		const filename = `${Date.now()}-${suffix}.png`;
		const filepath = path.join(dir, filename);
		fs.writeFileSync(filepath, buffer);
		this._log.debug({ sessionId, filepath }, "screenshot saved");
		return filepath;
	}

	async saveDomSnapshot(
		sessionId: string,
		html: string,
		action: string,
		label?: string,
	): Promise<string> {
		const dir = this.sessionDir(sessionId);
		const suffix = label ? `${action}-${label}` : action;
		const filename = `${Date.now()}-${suffix}.html`;
		const filepath = path.join(dir, filename);
		fs.writeFileSync(filepath, html, "utf8");
		this._log.debug({ sessionId, filepath }, "DOM snapshot saved");
		return filepath;
	}

	listSessionArtifacts(sessionId: string): string[] {
		const dir = this._resolveSessionDir(sessionId);
		if (!fs.existsSync(dir)) {
			return [];
		}
		return fs
			.readdirSync(dir)
			.map((f) => path.join(dir, f))
			.sort();
	}

	listSessions(): string[] {
		if (!fs.existsSync(this._baseDir)) {
			return [];
		}
		return fs
			.readdirSync(this._baseDir, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name)
			.sort();
	}

	deleteSession(sessionId: string): boolean {
		const dir = this._resolveSessionDir(sessionId);
		if (!fs.existsSync(dir)) {
			return false;
		}
		fs.rmSync(dir, { recursive: true, force: true });
		this._log.info({ sessionId }, "artifacts deleted");
		return true;
	}

	enforceRetention(): number {
		const sessions = this.listSessions().sort((a, b) => {
			const aTime = fs.statSync(this._resolveSessionDir(a)).mtimeMs;
			const bTime = fs.statSync(this._resolveSessionDir(b)).mtimeMs;
			return aTime - bTime;
		});
		if (sessions.length <= this._maxSessions) {
			return 0;
		}

		const toRemove = sessions.slice(0, sessions.length - this._maxSessions);
		for (const sessionId of toRemove) {
			this.deleteSession(sessionId);
		}

		this._log.info(
			{ removed: toRemove.length, remaining: this._maxSessions },
			"artifact retention enforced",
		);
		return toRemove.length;
	}
}
