import * as fs from "node:fs";
import * as path from "node:path";
import type { ActionContext, ActionOptions, ActionResult } from "./action.js";
import { executeAction } from "./action.js";

export async function screenshot(
	ctx: ActionContext,
	opts: ActionOptions & { label?: string; fullPage?: boolean } = {},
): Promise<ActionResult<string>> {
	return executeAction(ctx, "screenshot", { ...opts, screenshotOnFailure: false }, async (_ctx) => {
		const dir = _ctx.screenshotDir ?? path.join(process.cwd(), "screenshots");
		fs.mkdirSync(dir, { recursive: true });

		const label = opts.label ?? "capture";
		const filename = `${Date.now()}-${label}.png`;
		const filepath = path.join(dir, filename);

		await _ctx.page.screenshot({
			path: filepath,
			fullPage: opts.fullPage ?? false,
		});

		return filepath;
	});
}

export async function pdf(
	ctx: ActionContext,
	opts: ActionOptions & { label?: string } = {},
): Promise<ActionResult<string>> {
	return executeAction(ctx, "pdf", { ...opts, screenshotOnFailure: false }, async (_ctx) => {
		const dir = _ctx.screenshotDir ?? path.join(process.cwd(), "artifacts");
		fs.mkdirSync(dir, { recursive: true });

		const label = opts.label ?? "capture";
		const filename = `${Date.now()}-${label}.pdf`;
		const filepath = path.join(dir, filename);

		await _ctx.page.pdf({ path: filepath });

		return filepath;
	});
}

export async function evaluate<T>(
	ctx: ActionContext,
	script: string,
	opts: ActionOptions = {},
): Promise<ActionResult<T>> {
	return executeAction(ctx, "evaluate", opts, async (_ctx) => {
		return _ctx.page.evaluate(script) as Promise<T>;
	});
}

export type ScrollDirection = "up" | "down" | "left" | "right";

export async function scroll(
	ctx: ActionContext,
	direction: ScrollDirection,
	opts: ActionOptions & { amount?: number } = {},
): Promise<ActionResult<void>> {
	const amount = opts.amount ?? 500;

	return executeAction(ctx, "scroll", opts, async (_ctx) => {
		await _ctx.page.evaluate(
			({ direction, amount }) => {
				const map: Record<string, [number, number]> = {
					up: [0, -amount],
					down: [0, amount],
					left: [-amount, 0],
					right: [amount, 0],
				};
				const [x, y] = map[direction] ?? [0, 0];
				window.scrollBy(x, y);
			},
			{ direction, amount },
		);
	});
}

export interface PageState {
	url: string;
	title: string;
	readyState: string;
	isLoading: boolean;
}

export async function getPageState(
	ctx: ActionContext,
	opts: ActionOptions = {},
): Promise<ActionResult<PageState>> {
	return executeAction(ctx, "getPageState", opts, async (_ctx) => {
		const [title, readyState] = await Promise.all([
			_ctx.page.title(),
			_ctx.page.evaluate(() => document.readyState),
		]);

		return {
			url: _ctx.page.url(),
			title,
			readyState,
			isLoading: readyState !== "complete",
		};
	});
}
