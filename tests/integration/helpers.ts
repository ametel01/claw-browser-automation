import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ActionTrace } from "../../src/observe/trace.js";
import { BrowserPool } from "../../src/pool/browser-pool.js";
import { ActionLog } from "../../src/store/action-log.js";
import { ArtifactManager } from "../../src/store/artifacts.js";
import { Store } from "../../src/store/db.js";
import { SessionStore } from "../../src/store/sessions.js";
import type { SkillContext } from "../../src/tools/context.js";

export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

export async function waitFor(
	predicate: () => boolean | Promise<boolean>,
	timeoutMs: number,
	intervalMs = 50,
): Promise<void> {
	const startedAt = Date.now();
	while (!(await predicate())) {
		if (Date.now() - startedAt > timeoutMs) {
			throw new Error(`condition not met within ${timeoutMs}ms`);
		}
		await delay(intervalMs);
	}
}

export interface PoolOverrides {
	maxContexts?: number;
	healthCheckIntervalMs?: number;
}

export function createTestPool(overrides: PoolOverrides = {}): BrowserPool {
	return new BrowserPool({
		maxContexts: overrides.maxContexts ?? 4,
		launchOptions: { headless: true },
		healthCheckIntervalMs: overrides.healthCheckIntervalMs ?? 500,
	});
}

export interface TestContext {
	ctx: SkillContext;
	tmpDir: string;
	dbPath: string;
	cleanup: () => void;
}

export function createTestContext(pool: BrowserPool, tmpDir?: string): TestContext {
	const dir = tmpDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "claw-integ-"));
	const dbPath = path.join(dir, "test.db");
	const store = new Store({ dbPath });
	const sessions = new SessionStore(store.db);
	const actionLog = new ActionLog(store.db);
	const artifacts = new ArtifactManager({ baseDir: path.join(dir, "artifacts") });
	const trace = new ActionTrace();

	const noop = () => {};
	const logger = {
		info: noop,
		warn: noop,
		error: noop,
		debug: noop,
		trace: noop,
		fatal: noop,
		child: () => logger,
		level: "silent",
	} as unknown as SkillContext["logger"];

	const ctx: SkillContext = {
		pool,
		store,
		sessions,
		actionLog,
		artifacts,
		trace,
		logger,
	};

	const cleanup = () => {
		store.close();
		fs.rmSync(dir, { recursive: true, force: true });
	};

	return { ctx, tmpDir: dir, dbPath, cleanup };
}
