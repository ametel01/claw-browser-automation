/**
 * Typed error hierarchy for browser automation.
 *
 * Every subclass carries a machine-readable `code` and an actionable
 * `recoveryHint` so callers (and the agent) can decide how to retry.
 */

export class BrowserAutomationError extends Error {
	readonly code: string;
	readonly recoveryHint: string;

	constructor(code: string, message: string, recoveryHint: string) {
		super(message);
		this.name = "BrowserAutomationError";
		this.code = code;
		this.recoveryHint = recoveryHint;
	}
}

export class TargetNotFoundError extends BrowserAutomationError {
	constructor(message: string, recoveryHint?: string) {
		super(
			"TARGET_NOT_FOUND",
			message,
			recoveryHint ?? "Verify the selector is correct and the element exists on the page.",
		);
		this.name = "TargetNotFoundError";
	}
}

export class StaleElementError extends BrowserAutomationError {
	constructor(message: string, recoveryHint?: string) {
		super(
			"STALE_ELEMENT",
			message,
			recoveryHint ?? "Re-resolve the element handle — the DOM has changed since it was captured.",
		);
		this.name = "StaleElementError";
	}
}

export class AssertionFailedError extends BrowserAutomationError {
	constructor(message: string, recoveryHint?: string) {
		super(
			"ASSERTION_FAILED",
			message,
			recoveryHint ?? "Check the postcondition or verification logic for this action.",
		);
		this.name = "AssertionFailedError";
	}
}

export class NavigationInterruptedError extends BrowserAutomationError {
	constructor(message: string, recoveryHint?: string) {
		super(
			"NAVIGATION_INTERRUPTED",
			message,
			recoveryHint ??
				"The page navigated away during the action. Wait for navigation to settle before retrying.",
		);
		this.name = "NavigationInterruptedError";
	}
}

export class TimeoutExceededError extends BrowserAutomationError {
	constructor(message: string, recoveryHint?: string) {
		super(
			"TIMEOUT_EXCEEDED",
			message,
			recoveryHint ?? "Increase the timeout or ensure the page has finished loading.",
		);
		this.name = "TimeoutExceededError";
	}
}

export class SessionUnhealthyError extends BrowserAutomationError {
	constructor(message: string, recoveryHint?: string) {
		super(
			"SESSION_UNHEALTHY",
			message,
			recoveryHint ?? "The browser session is broken. Close it and create a new one.",
		);
		this.name = "SessionUnhealthyError";
	}
}
