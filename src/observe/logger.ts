import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import pino from "pino";

function resolveWritableLogDir(): string {
	const configured = process.env["BROWSER_LOG_DIR"];
	const candidates = configured
		? [configured]
		: [
				path.join(os.homedir(), ".openclaw", "workspace", "browser-automation", "logs"),
				path.join(process.cwd(), ".openclaw-logs"),
				path.join(os.tmpdir(), "openclaw-logs"),
			];

	for (const dir of candidates) {
		try {
			fs.mkdirSync(dir, { recursive: true });
			const probeFile = path.join(dir, `.probe-${process.pid}.log`);
			const fd = fs.openSync(probeFile, "a");
			fs.closeSync(fd);
			fs.rmSync(probeFile, { force: true });
			return dir;
		} catch {
			// Try next candidate if this location is not writable.
		}
	}

	throw new Error("no writable log directory available");
}

function resolveLogFile(name: string): string {
	const logDir = resolveWritableLogDir();
	const day = new Date().toISOString().slice(0, 10);
	return path.join(logDir, `${name}-${day}.log`);
}

export function createLogger(name: string) {
	const baseOptions = {
		name,
		level: process.env["LOG_LEVEL"] ?? "info",
		timestamp: pino.stdTimeFunctions.isoTime,
	};

	try {
		const fileStream = pino.destination({
			dest: resolveLogFile(name),
			sync: false,
			append: true,
		});

		return pino(baseOptions, pino.multistream([{ stream: process.stdout }, { stream: fileStream }]));
	} catch {
		return pino(baseOptions, process.stdout);
	}
}

export type Logger = pino.Logger;
