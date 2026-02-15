/**
 * Stable element handle registry.
 *
 * Maps agent-friendly handle IDs to selector strategies so elements
 * can be referenced across multiple action steps without re-specifying
 * the selector. Re-resolution happens lazily on each `resolve()` call,
 * tracking remaps when the winning strategy changes.
 */

import { nanoid } from "nanoid";
import type { Locator, Page } from "playwright-core";
import { StaleElementError } from "../errors.js";
import type { SelectorResolution, SelectorStrategy } from "../selectors/strategy.js";
import { resolveWithConfidence } from "../selectors/strategy.js";

export interface ElementHandle {
	handleId: string;
	selector: SelectorStrategy | SelectorStrategy[];
	/** The strategy that last successfully resolved. */
	lastStrategy: SelectorStrategy;
	/** How many times the winning strategy changed since registration. */
	remapCount: number;
}

export interface HandleResolution {
	locator: Locator;
	handle: ElementHandle;
	resolution: SelectorResolution;
	remapped: boolean;
}

export class HandleRegistry {
	private _handles = new Map<string, ElementHandle>();

	get size(): number {
		return this._handles.size;
	}

	/**
	 * Register an element by resolving its selector and assigning a stable ID.
	 */
	async register(
		page: Page,
		selector: SelectorStrategy | SelectorStrategy[],
		timeoutMs = 5000,
	): Promise<ElementHandle> {
		const selectorInput = Array.isArray(selector) ? selector : [selector];
		const resolution = await resolveWithConfidence(page, selectorInput, "attached", timeoutMs);

		const handle: ElementHandle = {
			handleId: nanoid(10),
			selector,
			lastStrategy: resolution.strategy,
			remapCount: 0,
		};
		this._handles.set(handle.handleId, handle);
		return handle;
	}

	/**
	 * Resolve a handle to a live locator. Re-resolves via the original selector
	 * strategy, trying the last successful strategy first for speed.
	 */
	async resolve(page: Page, handleId: string, timeoutMs = 5000): Promise<HandleResolution> {
		const handle = this._handles.get(handleId);
		if (!handle) {
			throw new StaleElementError(`handle not found: ${handleId}`);
		}

		const strategies = this._buildPrioritizedStrategies(handle);
		const resolution = await resolveWithConfidence(page, strategies, "attached", timeoutMs);
		const remapped =
			resolution.strategy.type !== handle.lastStrategy.type ||
			JSON.stringify(resolution.strategy) !== JSON.stringify(handle.lastStrategy);

		if (remapped) {
			handle.lastStrategy = resolution.strategy;
			handle.remapCount++;
		}

		return {
			locator: resolution.locator,
			handle,
			resolution,
			remapped,
		};
	}

	/**
	 * Release a single handle.
	 */
	release(handleId: string): boolean {
		return this._handles.delete(handleId);
	}

	/**
	 * Release all handles.
	 */
	clear(): void {
		this._handles.clear();
	}

	/**
	 * Get a handle by ID without resolving it.
	 */
	get(handleId: string): ElementHandle | undefined {
		return this._handles.get(handleId);
	}

	/**
	 * List all registered handles.
	 */
	list(): ElementHandle[] {
		return [...this._handles.values()];
	}

	/**
	 * Build a strategy array with the last successful strategy first,
	 * followed by the remaining strategies in original order.
	 */
	private _buildPrioritizedStrategies(handle: ElementHandle): SelectorStrategy[] {
		const original = Array.isArray(handle.selector) ? handle.selector : [handle.selector];
		const lastJson = JSON.stringify(handle.lastStrategy);

		// Put lastStrategy first, then the rest (excluding duplicate of lastStrategy)
		const rest = original.filter((s) => JSON.stringify(s) !== lastJson);
		return [handle.lastStrategy, ...rest];
	}
}
