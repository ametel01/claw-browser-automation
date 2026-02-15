import { beforeEach, describe, expect, it } from "vitest";
import type { TraceEntry } from "../../src/observe/trace.js";
import { ActionTrace } from "../../src/observe/trace.js";

function makeEntry(overrides: Partial<TraceEntry> = {}): TraceEntry {
	return {
		action: "click",
		timestamp: Date.now(),
		durationMs: 100,
		ok: true,
		retries: 0,
		...overrides,
	};
}

describe("ActionTrace", () => {
	let trace: ActionTrace;

	beforeEach(() => {
		trace = new ActionTrace();
	});

	it("should record and retrieve session traces", () => {
		trace.record("s1", makeEntry({ action: "navigate" }));
		trace.record("s1", makeEntry({ action: "click", selector: "#btn" }));

		const entries = trace.getSessionTrace("s1");
		expect(entries).toHaveLength(2);
		expect(entries[0]?.action).toBe("navigate");
		expect(entries[1]?.action).toBe("click");
		expect(entries[1]?.selector).toBe("#btn");
	});

	it("should return empty trace for unknown session", () => {
		expect(trace.getSessionTrace("unknown")).toHaveLength(0);
	});

	it("should isolate traces between sessions", () => {
		trace.record("s1", makeEntry({ action: "navigate" }));
		trace.record("s2", makeEntry({ action: "click" }));

		expect(trace.getSessionTrace("s1")).toHaveLength(1);
		expect(trace.getSessionTrace("s2")).toHaveLength(1);
	});

	it("should generate a readable session summary", () => {
		trace.record("s1", makeEntry({ action: "navigate", durationMs: 50 }));
		trace.record("s1", makeEntry({ action: "click", selector: "#btn", durationMs: 120 }));
		trace.record(
			"s1",
			makeEntry({
				action: "type",
				selector: "#input",
				ok: false,
				error: "timeout",
				retries: 2,
				durationMs: 5000,
			}),
		);

		const summary = trace.getSessionSummary("s1");
		expect(summary).toContain("1. navigate");
		expect(summary).toContain("2. click (#btn)");
		expect(summary).toContain("3. type (#input) → FAIL: timeout");
		expect(summary).toContain("[2 retries]");
	});

	it("should return default summary for empty session", () => {
		expect(trace.getSessionSummary("empty")).toBe("no actions recorded");
	});

	it("should compute stats across all sessions", () => {
		trace.record("s1", makeEntry({ action: "navigate", durationMs: 50, retries: 0 }));
		trace.record("s1", makeEntry({ action: "click", durationMs: 100, retries: 1 }));
		trace.record("s1", makeEntry({ action: "click", durationMs: 200, ok: false, retries: 3 }));
		trace.record("s2", makeEntry({ action: "type", durationMs: 80, retries: 0 }));

		const stats = trace.stats();
		expect(stats.actionsTotal).toBe(4);
		expect(stats.actionsByType["click"]).toBe(2);
		expect(stats.actionsByType["navigate"]).toBe(1);
		expect(stats.actionsByType["type"]).toBe(1);
		expect(stats.actionsByOutcome.ok).toBe(3);
		expect(stats.actionsByOutcome.failed).toBe(1);
		expect(stats.retriesTotal).toBe(4);
		expect(stats.sessionsTotal).toBe(2);
		expect(stats.durationP50Ms).toBeGreaterThanOrEqual(50);
		expect(stats.durationP95Ms).toBe(200);
	});

	it("should return zero percentiles for empty stats", () => {
		const stats = trace.stats();
		expect(stats.durationP50Ms).toBe(0);
		expect(stats.durationP95Ms).toBe(0);
	});

	it("should clear session trace", () => {
		trace.record("s1", makeEntry({ action: "click", retries: 2, durationMs: 120 }));
		trace.record("s2", makeEntry({ action: "navigate", retries: 0, durationMs: 40 }));
		trace.clearSession("s1");
		expect(trace.getSessionTrace("s1")).toHaveLength(0);
		const stats = trace.stats();
		expect(stats.actionsTotal).toBe(1);
		expect(stats.actionsByType["click"]).toBeUndefined();
		expect(stats.actionsByType["navigate"]).toBe(1);
		expect(stats.retriesTotal).toBe(0);
		expect(stats.sessionsTotal).toBe(1);
	});

	it("should reset all state", () => {
		trace.record("s1", makeEntry());
		trace.record("s2", makeEntry());
		trace.reset();

		expect(trace.getSessionTrace("s1")).toHaveLength(0);
		expect(trace.getSessionTrace("s2")).toHaveLength(0);
		expect(trace.stats().actionsTotal).toBe(0);
		expect(trace.stats().sessionsTotal).toBe(0);
	});
});
