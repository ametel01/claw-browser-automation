export interface SessionSnapshot {
	sessionId: string;
	url: string;
	cookies: CookieData[];
	localStorage: Record<string, string>;
	timestamp: number;
}

export interface CookieData {
	name: string;
	value: string;
	domain: string;
	path: string;
	expires: number;
	httpOnly: boolean;
	secure: boolean;
	sameSite: "Strict" | "Lax" | "None";
}
