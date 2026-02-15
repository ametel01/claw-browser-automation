import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SessionSnapshot } from "./snapshot.js";

const DEFAULT_PROFILES_DIR = path.join(os.homedir(), ".openclaw", "browser-profiles");
const PROFILE_SNAPSHOT_FILE = "session-snapshot.json";
const PROFILE_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

function assertValidProfileName(name: string): void {
	if (!PROFILE_NAME_PATTERN.test(name)) {
		throw new Error(
			`invalid profile name "${name}": only letters, numbers, underscore, and hyphen are allowed`,
		);
	}
}

function resolveProfilePath(name: string): string {
	assertValidProfileName(name);
	const base = path.resolve(getProfilesDir());
	const profilePath = path.resolve(base, name);
	if (profilePath !== base && !profilePath.startsWith(`${base}${path.sep}`)) {
		throw new Error(`profile path escapes profiles directory: ${name}`);
	}
	return profilePath;
}

function getSnapshotPath(name: string): string {
	return path.join(resolveProfilePath(name), PROFILE_SNAPSHOT_FILE);
}

export function getProfilesDir(): string {
	return process.env["BROWSER_PROFILES_DIR"] ?? DEFAULT_PROFILES_DIR;
}

export function getProfilePath(name: string): string {
	return resolveProfilePath(name);
}

export function listProfiles(): string[] {
	const dir = path.resolve(getProfilesDir());
	if (!fs.existsSync(dir)) {
		return [];
	}
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && PROFILE_NAME_PATTERN.test(entry.name))
		.map((entry) => entry.name);
}

export function profileExists(name: string): boolean {
	return fs.existsSync(resolveProfilePath(name));
}

export function ensureProfileDir(name: string): string {
	const profilePath = resolveProfilePath(name);
	fs.mkdirSync(profilePath, { recursive: true });
	return profilePath;
}

export function loadProfileSnapshot(name: string): SessionSnapshot | undefined {
	const snapshotPath = getSnapshotPath(name);
	if (!fs.existsSync(snapshotPath)) {
		return undefined;
	}
	const raw = fs.readFileSync(snapshotPath, "utf8");
	return JSON.parse(raw) as SessionSnapshot;
}

export function saveProfileSnapshot(name: string, snapshot: SessionSnapshot): void {
	ensureProfileDir(name);
	const snapshotPath = getSnapshotPath(name);
	fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

export function exportProfileSnapshot(name: string): string | undefined {
	const snapshotPath = getSnapshotPath(name);
	if (!fs.existsSync(snapshotPath)) {
		return undefined;
	}
	return fs.readFileSync(snapshotPath, "utf8");
}

export function deleteProfile(name: string): boolean {
	const profilePath = resolveProfilePath(name);
	if (!fs.existsSync(profilePath)) {
		return false;
	}
	fs.rmSync(profilePath, { recursive: true, force: true });
	return true;
}
