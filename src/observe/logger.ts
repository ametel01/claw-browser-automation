import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import pino from "pino";

function resolveLogFile(name: string): string {
	const logDir =
		process.env["BROWSER_LOG_DIR"] ??
		path.join(os.homedir(), ".openclaw", "workspace", "browser-automation", "logs");
	fs.mkdirSync(logDir, { recursive: true });
	const day = new Date().toISOString().slice(0, 10);
	return path.join(logDir, `${name}-${day}.log`);
}

export function createLogger(name: string) {
	const fileStream = pino.destination({
		dest: resolveLogFile(name),
		sync: false,
		append: true,
	});

	return pino({
		name,
		level: process.env["LOG_LEVEL"] ?? "info",
		timestamp: pino.stdTimeFunctions.isoTime,
	}, pino.multistream([{ stream: process.stdout }, { stream: fileStream }]));
}

export type Logger = pino.Logger;
