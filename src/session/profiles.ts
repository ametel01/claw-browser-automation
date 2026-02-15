import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const DEFAULT_PROFILES_DIR = path.join(os.homedir(), ".openclaw", "browser-profiles");

export function getProfilesDir(): string {
	return process.env["BROWSER_PROFILES_DIR"] ?? DEFAULT_PROFILES_DIR;
}

export function getProfilePath(name: string): string {
	return path.join(getProfilesDir(), name);
}

export function listProfiles(): string[] {
	const dir = getProfilesDir();
	if (!fs.existsSync(dir)) {
		return [];
	}
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
}

export function profileExists(name: string): boolean {
	return fs.existsSync(getProfilePath(name));
}

export function ensureProfileDir(name: string): string {
	const profilePath = getProfilePath(name);
	fs.mkdirSync(profilePath, { recursive: true });
	return profilePath;
}

export function deleteProfile(name: string): boolean {
	const profilePath = getProfilePath(name);
	if (!fs.existsSync(profilePath)) {
		return false;
	}
	fs.rmSync(profilePath, { recursive: true, force: true });
	return true;
}
