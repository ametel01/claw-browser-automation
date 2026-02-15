import { afterEach, describe, expect, it } from "vitest";
import { BrowserPool } from "../../src/pool/browser-pool.js";

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function waitFor(
	predicate: () => boolean,
	timeoutMs: number,
	intervalMs = 20,
): Promise<void> {
	const startedAt = Date.now();
	while (!predicate()) {
		if (Date.now() - startedAt > timeoutMs) {
			throw new Error(`condition not met within ${timeoutMs}ms`);
		}
		await delay(intervalMs);
	}
}

describe("BrowserPool", () => {
	let pool: BrowserPool;
	const previousProfilesDir = process.env["BROWSER_PROFILES_DIR"];

	afterEach(async () => {
		if (pool) {
			await pool.shutdown();
		}
		if (previousProfilesDir === undefined) {
			delete process.env["BROWSER_PROFILES_DIR"];
		} else {
			process.env["BROWSER_PROFILES_DIR"] = previousProfilesDir;
		}
	});

	it("should launch browser and acquire a session", async () => {
		pool = new BrowserPool({ launchOptions: { headless: true } });
		const session = await pool.acquire();

		expect(session.id).toBeTruthy();
		expect(session.isHealthy()).toBe(true);
		expect(session.currentUrl()).toBe("about:blank");

		const status = pool.status();
		expect(status.running).toBe(true);
		expect(status.activeSessions).toBe(1);
	});

	it("should navigate to a URL on acquire", async () => {
		pool = new BrowserPool({ launchOptions: { headless: true } });
		const session = await pool.acquire({ url: "data:text/html,<h1>hello</h1>" });

		expect(session.currentUrl()).toContain("data:text/html");
	});

	it("should enforce maxContexts limit", async () => {
		pool = new BrowserPool({ maxContexts: 1, launchOptions: { headless: true } });
		await pool.acquire();

		await expect(pool.acquire()).rejects.toThrow("pool limit reached");
	});

	it("should release sessions back to pool", async () => {
		pool = new BrowserPool({ maxContexts: 1, launchOptions: { headless: true } });
		const session = await pool.acquire();

		expect(pool.status().activeSessions).toBe(1);
		await pool.release(session);
		expect(pool.status().activeSessions).toBe(0);

		const session2 = await pool.acquire();
		expect(session2.id).not.toBe(session.id);
	});

	it("should destroy a specific session", async () => {
		pool = new BrowserPool({ launchOptions: { headless: true } });
		const s1 = await pool.acquire();
		const s2 = await pool.acquire();

		await pool.destroy(s1.id);
		expect(pool.status().activeSessions).toBe(1);
		expect(pool.getSession(s1.id)).toBeUndefined();
		expect(pool.getSession(s2.id)).toBeDefined();
	});

	it("should take and restore snapshots", async () => {
		pool = new BrowserPool({ launchOptions: { headless: true } });
		const session = await pool.acquire({
			url: "data:text/html,<h1>snapshot test</h1>",
		});

		const snapshot = await session.snapshot();
		expect(snapshot.sessionId).toBe(session.id);
		expect(snapshot.url).toContain("data:text/html");
		expect(snapshot.timestamp).toBeGreaterThan(0);
		expect(snapshot.cookies).toBeInstanceOf(Array);

		await session.page.goto("about:blank");
		await session.restore(snapshot);
		expect(session.currentUrl()).toContain("data:text/html");
	});

	it("should reject unsafe profile names", async () => {
		pool = new BrowserPool({ launchOptions: { headless: true } });
		await expect(pool.acquire({ profile: "../escape" })).rejects.toThrow("invalid profile name");
	});

	it("should restore a saved profile snapshot on next acquire", async () => {
		process.env["BROWSER_PROFILES_DIR"] = `/tmp/claw-profiles-${Date.now()}`;

		pool = new BrowserPool({ launchOptions: { headless: true } });
		const first = await pool.acquire({
			profile: "regression_profile",
			url: "data:text/html,<h1>persist me</h1>",
		});
		await pool.release(first);
		await pool.shutdown();

		pool = new BrowserPool({ launchOptions: { headless: true } });
		const restored = await pool.acquire({ profile: "regression_profile" });
		expect(restored.currentUrl()).toContain("data:text/html,<h1>persist me</h1>");
	});

	it("should recover session after health check circuit breaker", async () => {
		pool = new BrowserPool({
			launchOptions: { headless: true },
			healthCheckIntervalMs: 25,
		});
		const session = await pool.acquire({
			profile: "health_recovery",
			url: "data:text/html,<h1>health</h1>",
		});
		const previousId = session.id;

		await session.page.close();
		await waitFor(
			() => pool.listSessions().some((trackedSession) => trackedSession.id !== previousId),
			2000,
		);

		expect(pool.status().activeSessions).toBe(1);
		expect(pool.listSessions()[0]?.id).not.toBe(previousId);
	});

	it("should list all active sessions", async () => {
		pool = new BrowserPool({ launchOptions: { headless: true } });
		await pool.acquire();
		await pool.acquire();

		const sessions = pool.listSessions();
		expect(sessions).toHaveLength(2);
	});

	it("should shutdown cleanly", async () => {
		pool = new BrowserPool({ launchOptions: { headless: true } });
		await pool.acquire();
		await pool.acquire();

		await pool.shutdown();
		expect(pool.status().running).toBe(false);
		expect(pool.status().activeSessions).toBe(0);
	});
});
