import { describe, it, expect, afterEach } from "vitest";
import { BrowserPool } from "../../src/pool/browser-pool.js";

describe("BrowserPool", () => {
	let pool: BrowserPool;

	afterEach(async () => {
		if (pool) {
			await pool.shutdown();
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

		// Can acquire again after release
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
