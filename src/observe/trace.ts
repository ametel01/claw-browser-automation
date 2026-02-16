export interface SelectorResolutionTrace {
	strategy: string;
	strategyIndex: number;
	resolutionMs: number;
}

export interface TraceEntry {
	action: string;
	selector?: string;
	timestamp: number;
	durationMs: number;
	ok: boolean;
	error?: string;
	retries: number;
	selectorResolved?: SelectorResolutionTrace;
	eventsDispatched?: string[];
	waitsPerformed?: string[];
	assertionsChecked?: string[];
}

export interface TraceStats {
	actionsTotal: number;
	actionsByType: Record<string, number>;
	actionsByOutcome: { ok: number; failed: number };
	retriesTotal: number;
	sessionsTotal: number;
	durationP50Ms: number;
	durationP95Ms: number;
}

interface ActionTraceOptions {
	maxEntriesPerSession?: number;
	maxDurationSamples?: number;
}

interface DurationSample {
	sessionId: string;
	timestamp: number;
	durationMs: number;
}

export class ActionTrace {
	private _entries: Map<string, TraceEntry[]> = new Map();
	private _allDurations: DurationSample[] = [];
	private _totalRetries = 0;
	private _outcomeOk = 0;
	private _outcomeFailed = 0;
	private _actionCounts: Map<string, number> = new Map();
	private _maxEntriesPerSession: number;
	private _maxDurationSamples: number;

	constructor(opts: ActionTraceOptions = {}) {
		const maxEntriesPerSession = opts.maxEntriesPerSession ?? 2000;
		const maxDurationSamples = opts.maxDurationSamples ?? 5000;

		this._maxEntriesPerSession = Math.max(1, maxEntriesPerSession);
		this._maxDurationSamples = Math.max(1, maxDurationSamples);
	}

	record(sessionId: string, entry: TraceEntry): void {
		let entries = this._entries.get(sessionId);
		if (!entries) {
			entries = [];
			this._entries.set(sessionId, entries);
		}
		entries.push(entry);
		while (entries.length > this._maxEntriesPerSession) {
			const removed = entries.shift();
			if (removed) {
				this._removeDuration(sessionId, removed.timestamp, removed.durationMs);
				this._adjustAggregate(-1, removed);
			}
		}

		this._allDurations.push({
			sessionId,
			timestamp: entry.timestamp,
			durationMs: entry.durationMs,
		});
		if (this._allDurations.length > this._maxDurationSamples) {
			this._allDurations.shift();
		}
		this._totalRetries += entry.retries;

		if (entry.ok) {
			this._outcomeOk++;
		} else {
			this._outcomeFailed++;
		}

		const count = this._actionCounts.get(entry.action) ?? 0;
		this._actionCounts.set(entry.action, count + 1);
	}

	getSessionTrace(sessionId: string): TraceEntry[] {
		const entries = this._entries.get(sessionId) ?? [];
		return [...entries];
	}

	getSessionSummary(sessionId: string): string {
		const entries = this.getSessionTrace(sessionId);
		if (entries.length === 0) {
			return "no actions recorded";
		}

		const lines = entries.map((e, i) => {
			const status = e.ok ? "OK" : `FAIL: ${e.error ?? "unknown"}`;
			const selector = e.selector ? ` (${e.selector})` : "";
			const retries = e.retries > 0 ? ` [${e.retries} retries]` : "";
			return `${i + 1}. ${e.action}${selector} → ${status} (${e.durationMs}ms)${retries}`;
		});

		return lines.join("\n");
	}

	clearSession(sessionId: string): void {
		if (!this._entries.delete(sessionId)) {
			return;
		}
		this._recomputeAggregates();
	}

	stats(): TraceStats {
		const sorted = [...this._allDurations].map((sample) => sample.durationMs).sort((a, b) => a - b);
		const actionsByType: Record<string, number> = {};
		for (const [action, count] of this._actionCounts) {
			actionsByType[action] = count;
		}

		return {
			actionsTotal: this._outcomeOk + this._outcomeFailed,
			actionsByType,
			actionsByOutcome: { ok: this._outcomeOk, failed: this._outcomeFailed },
			retriesTotal: this._totalRetries,
			sessionsTotal: this._entries.size,
			durationP50Ms: percentile(sorted, 0.5),
			durationP95Ms: percentile(sorted, 0.95),
		};
	}

	reset(): void {
		this._entries.clear();
		this._allDurations = [];
		this._totalRetries = 0;
		this._outcomeOk = 0;
		this._outcomeFailed = 0;
		this._actionCounts.clear();
	}

	private _recomputeAggregates(): void {
		this._allDurations = [];
		this._totalRetries = 0;
		this._outcomeOk = 0;
		this._outcomeFailed = 0;
		this._actionCounts.clear();

		const allDurations: DurationSample[] = [];
		for (const [sessionId, sessionEntries] of this._entries) {
			for (const entry of sessionEntries) {
				allDurations.push({
					sessionId,
					timestamp: entry.timestamp,
					durationMs: entry.durationMs,
				});
				this._totalRetries += entry.retries;
				if (entry.ok) {
					this._outcomeOk++;
				} else {
					this._outcomeFailed++;
				}
				const count = this._actionCounts.get(entry.action) ?? 0;
				this._actionCounts.set(entry.action, count + 1);
			}
		}

		allDurations.sort((a, b) => a.timestamp - b.timestamp);
		if (allDurations.length > this._maxDurationSamples) {
			allDurations.splice(0, allDurations.length - this._maxDurationSamples);
		}
		this._allDurations = allDurations;
	}

	private _adjustAggregate(sign: number, entry: TraceEntry): void {
		this._totalRetries += sign * entry.retries;
		if (entry.ok) {
			this._outcomeOk += sign;
		} else {
			this._outcomeFailed += sign;
		}

		const count = this._actionCounts.get(entry.action) ?? 0;
		const nextCount = count + sign;
		if (nextCount <= 0) {
			this._actionCounts.delete(entry.action);
		} else {
			this._actionCounts.set(entry.action, nextCount);
		}
	}

	private _removeDuration(sessionId: string, timestamp: number, durationMs: number): void {
		const index = this._allDurations.findIndex(
			(sample) =>
				sample.sessionId === sessionId &&
				sample.timestamp === timestamp &&
				sample.durationMs === durationMs,
		);
		if (index >= 0) {
			this._allDurations.splice(index, 1);
		}
	}
}

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) {
		return 0;
	}
	const idx = Math.ceil(sorted.length * p) - 1;
	return sorted[Math.max(0, idx)] ?? 0;
}
