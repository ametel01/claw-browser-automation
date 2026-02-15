import pino from "pino";

export function createLogger(name: string) {
	return pino({
		name,
		level: process.env["LOG_LEVEL"] ?? "info",
		timestamp: pino.stdTimeFunctions.isoTime,
	});
}

export type Logger = pino.Logger;
