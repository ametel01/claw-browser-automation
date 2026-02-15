/**
 * Schema-based structured extraction with provenance tracking.
 *
 * Uses TypeBox schemas to define the expected shape. Each extracted item
 * includes provenance metadata showing which DOM node produced it.
 */

import type { TObject, TProperties } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Locator } from "playwright-core";
import type { Selector, SelectorResolution } from "../selectors/strategy.js";
import { resolveWithConfidence } from "../selectors/strategy.js";
import type { ActionContext, ActionOptions, ActionResult } from "./action.js";
import { executeAction, resolveTimeout } from "./action.js";
import { waitForDomStability } from "./resilience.js";

export interface ItemProvenance {
	index: number;
	tagName: string;
	id: string;
	className: string;
	strategy: string;
}

interface RawElementData {
	data: Record<string, string>;
	tagName: string;
	id: string;
	className: string;
}

interface FieldDescriptor {
	outputKey: string;
	sourceAttribute: string;
}

export interface ExtractionResult<T> {
	data: T[];
	provenance: ItemProvenance[];
}

export interface ExtractStructuredOptions extends ActionOptions {
	/** Maximum number of items to extract. Default: unlimited. */
	limit?: number;
}

async function evaluateElement(el: Locator, propertyNames: string[]): Promise<RawElementData> {
	return el.evaluate((node, props) => {
		// NOTE: extractNodeProps cannot be called here — this runs in browser context.
		// The function body is serialized, so we inline the logic.
		const result: Record<string, string> = {};
		for (const prop of props) {
			if (prop === "textContent") {
				result[prop] = (node.textContent ?? "").trim();
			} else if (prop === "innerHTML") {
				result[prop] = (node as HTMLElement).innerHTML ?? "";
			} else {
				result[prop] = (node as HTMLElement).getAttribute(prop) ?? "";
			}
		}
		return {
			data: result,
			tagName: node.nodeName.toLowerCase(),
			id: (node as HTMLElement).id ?? "",
			className: (node as HTMLElement).className ?? "",
		};
	}, propertyNames);
}

function normalizeSourceAttribute(attr: string): string {
	const trimmed = attr.trim();
	if (trimmed.length === 0) {
		return "textContent";
	}
	return trimmed;
}

function buildFieldDescriptors<P extends TProperties>(schema: TObject<P>): FieldDescriptor[] {
	return Object.entries(schema.properties).map(([outputKey, schemaProp]) => {
		const sourceAttribute =
			typeof schemaProp.description === "string" && schemaProp.description.trim().length > 0
				? schemaProp.description
				: outputKey;
		return {
			outputKey,
			sourceAttribute: normalizeSourceAttribute(sourceAttribute),
		};
	});
}

function buildProvenance(
	index: number,
	raw: RawElementData,
	resolution: SelectorResolution,
): ItemProvenance {
	return {
		index,
		tagName: raw.tagName,
		id: raw.id,
		className: typeof raw.className === "string" ? raw.className : "",
		strategy: resolution.strategy.type,
	};
}

export async function extractStructured<P extends TProperties>(
	ctx: ActionContext,
	selector: Selector,
	schema: TObject<P>,
	opts: ExtractStructuredOptions = {},
): Promise<ActionResult<ExtractionResult<Record<string, unknown>>>> {
	const timeoutMs = resolveTimeout(opts.timeout);
	const fieldDescriptors = buildFieldDescriptors(schema);
	const sourceAttributes = fieldDescriptors.map((field) => field.sourceAttribute);

	return executeAction(ctx, "extractStructured", opts, async (_ctx) => {
		await waitForDomStability(_ctx.page, 200, Math.min(timeoutMs, 5000));
		const resolution = await resolveWithConfidence(_ctx.page, selector, "attached", timeoutMs);
		const locator = resolution.locator;
		await locator.first().waitFor({ state: "attached", timeout: timeoutMs });

		const count = await locator.count();
		const limit = opts.limit ?? count;
		const itemCount = Math.min(count, limit);

		const data: Record<string, unknown>[] = [];
		const provenance: ItemProvenance[] = [];

		for (let i = 0; i < itemCount; i++) {
			const raw = await evaluateElement(locator.nth(i), sourceAttributes);
			const mapped = mapExtractedData(raw.data, fieldDescriptors);
			const item = coerceToSchema(mapped, schema);

			if (Value.Check(schema, item)) {
				data.push(item);
				provenance.push(buildProvenance(i, raw, resolution));
			}
		}

		return { data, provenance };
	});
}

function coerceToSchema<P extends TProperties>(
	raw: Record<string, string>,
	schema: TObject<P>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, schemaProp] of Object.entries(schema.properties)) {
		const value = raw[key] ?? "";
		const kind = (schemaProp as { type?: string }).type;
		if (kind === "number" || kind === "integer") {
			result[key] = Number(value) || 0;
		} else if (kind === "boolean") {
			result[key] = value === "true" || value === "1";
		} else {
			result[key] = value;
		}
	}
	return result;
}

function mapExtractedData(
	raw: Record<string, string>,
	descriptors: FieldDescriptor[],
): Record<string, string> {
	const mapped: Record<string, string> = {};
	for (const descriptor of descriptors) {
		mapped[descriptor.outputKey] = raw[descriptor.sourceAttribute] ?? "";
	}
	return mapped;
}
