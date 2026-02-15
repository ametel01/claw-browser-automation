import { describe, expect, it } from "vitest";
import { toStructuredError } from "../../src/actions/action.js";
import {
	AssertionFailedError,
	BrowserAutomationError,
	NavigationInterruptedError,
	SessionUnhealthyError,
	StaleElementError,
	TargetNotFoundError,
	TimeoutExceededError,
} from "../../src/errors.js";

describe("Error Taxonomy", () => {
	it("BrowserAutomationError has code, message, and recoveryHint", () => {
		const err = new BrowserAutomationError("TEST_CODE", "test message", "try again");
		expect(err.code).toBe("TEST_CODE");
		expect(err.message).toBe("test message");
		expect(err.recoveryHint).toBe("try again");
		expect(err.name).toBe("BrowserAutomationError");
		expect(err).toBeInstanceOf(Error);
	});

	it("TargetNotFoundError has correct code and default hint", () => {
		const err = new TargetNotFoundError("element #foo not found");
		expect(err.code).toBe("TARGET_NOT_FOUND");
		expect(err.name).toBe("TargetNotFoundError");
		expect(err.recoveryHint).toContain("selector");
		expect(err).toBeInstanceOf(BrowserAutomationError);
	});

	it("TargetNotFoundError accepts custom recovery hint", () => {
		const err = new TargetNotFoundError("not found", "use a different selector");
		expect(err.recoveryHint).toBe("use a different selector");
	});

	it("StaleElementError has correct code", () => {
		const err = new StaleElementError("element detached");
		expect(err.code).toBe("STALE_ELEMENT");
		expect(err.name).toBe("StaleElementError");
		expect(err).toBeInstanceOf(BrowserAutomationError);
	});

	it("AssertionFailedError has correct code", () => {
		const err = new AssertionFailedError("value mismatch");
		expect(err.code).toBe("ASSERTION_FAILED");
		expect(err.name).toBe("AssertionFailedError");
		expect(err).toBeInstanceOf(BrowserAutomationError);
	});

	it("NavigationInterruptedError has correct code", () => {
		const err = new NavigationInterruptedError("page navigated away");
		expect(err.code).toBe("NAVIGATION_INTERRUPTED");
		expect(err.name).toBe("NavigationInterruptedError");
		expect(err).toBeInstanceOf(BrowserAutomationError);
	});

	it("TimeoutExceededError has correct code", () => {
		const err = new TimeoutExceededError("timed out after 5000ms");
		expect(err.code).toBe("TIMEOUT_EXCEEDED");
		expect(err.name).toBe("TimeoutExceededError");
		expect(err).toBeInstanceOf(BrowserAutomationError);
	});

	it("SessionUnhealthyError has correct code", () => {
		const err = new SessionUnhealthyError("context destroyed");
		expect(err.code).toBe("SESSION_UNHEALTHY");
		expect(err.name).toBe("SessionUnhealthyError");
		expect(err).toBeInstanceOf(BrowserAutomationError);
	});

	it("all error types are catchable as BrowserAutomationError", () => {
		const errors = [
			new TargetNotFoundError("x"),
			new StaleElementError("x"),
			new AssertionFailedError("x"),
			new NavigationInterruptedError("x"),
			new TimeoutExceededError("x"),
			new SessionUnhealthyError("x"),
		];
		for (const err of errors) {
			expect(err).toBeInstanceOf(BrowserAutomationError);
			expect(err).toBeInstanceOf(Error);
		}
	});
});

describe("toStructuredError", () => {
	it("converts BrowserAutomationError to StructuredError object", () => {
		const err = new TargetNotFoundError("not found");
		const result = toStructuredError(err);
		expect(typeof result).toBe("object");
		if (typeof result === "object") {
			expect(result.code).toBe("TARGET_NOT_FOUND");
			expect(result.message).toBe("not found");
			expect(result.recoveryHint).toBeTruthy();
		}
	});

	it("converts generic Error to string", () => {
		const err = new Error("generic failure");
		const result = toStructuredError(err);
		expect(result).toBe("generic failure");
	});

	it("converts non-Error to string", () => {
		expect(toStructuredError("string error")).toBe("string error");
		expect(toStructuredError(42)).toBe("42");
	});
});
