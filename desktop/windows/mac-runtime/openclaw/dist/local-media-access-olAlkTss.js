/* pinkie-image-access:v5 */
import { deniedMediaPath as _pinkieDeniedMediaPath } from "./pinkie-media-inbox.mjs";
import os from "node:os";
import fsSync from "node:fs";
import { g as assertNoWindowsNetworkPath, i as isPathInside } from "./path-DILYn_gk.js";
import "./path-guards-CBe_wA_B.js";
import "./local-file-access-CBe_wA_B.js";
import { a as resolveInboundMediaReference } from "./media-reference-Cswh9n78.js";
import { t as isInboundPathAllowed } from "./inbound-path-policy-CH_uJYn5.js";
import { a as getDefaultMediaLocalRoots } from "./local-roots-CAoJyC6u.js";
import path from "node:path";
import fs from "node:fs/promises";
//#region src/media/local-media-access.ts
/** Error raised when a local media path escapes the configured allowlist. */
var LocalMediaAccessError = class extends Error {
	constructor(code, message, options) {
		super(message, options);
		this.code = code;
		this.name = "LocalMediaAccessError";
	}
};
/** Returns the default root allowlist for local media reads. */
function getDefaultLocalRoots() {
	return getDefaultMediaLocalRoots();
}
/** Resolves an allowlist once for callers that validate several media paths. */
async function resolveLocalMediaRoots(localRoots) {
	const roots = localRoots ?? getDefaultLocalRoots();
	return await Promise.all(roots.map(async (root) => {
		let resolvedRoot;
		try {
			resolvedRoot = await fs.realpath(root);
		} catch {
			resolvedRoot = path.resolve(root);
		}
		if (resolvedRoot === path.parse(resolvedRoot).root) throw new LocalMediaAccessError("invalid-root", `Invalid localRoots entry (refuses filesystem root): ${root}. Pass a narrower directory.`);
		return resolvedRoot;
	}));
}
function _pinkieDeniedError(mediaPath) {
	const message = `Local media path is not under an allowed directory: ${mediaPath}`;
	if (typeof LocalMediaAccessError === "function") return new LocalMediaAccessError("path-not-allowed", message);
	return Object.assign(new Error(message), { code: "path-not-allowed" });
}
let _pinkieExtraMediaRoots;
function _pinkieWorkspaceRoots(home) {
  const stateDir = path.resolve(path.join(home, ".openclaw"));
  let entries = [];
  try { entries = fsSync.readdirSync(stateDir, { withFileTypes: true }); } catch {}
  return entries.flatMap((entry) => {
    /* Do not allow ~/.openclaw itself: it holds settings and credentials.
       Only real workspace directories get a display-media exception. */
    if (!entry.isDirectory() || !/^workspace(?:-[a-z0-9][a-z0-9._-]*)?$/i.test(entry.name)) return [];
    try { return [path.resolve(stateDir, entry.name)]; } catch { return []; }
  });
}
let _pinkieProjectRootsCache;
function _pinkieProjectRoots() {
  const home = (os && typeof os.homedir === "function") ? os.homedir() : (process.env.HOME || process.env.USERPROFILE || "");
  const stateRoot = process.env.PINKIE_STATE_ROOT || path.join(home, "Library/Application Support/SuperPinkie");
  const file = path.join(stateRoot, "project-scope", "bindings.json");
  let mtime = -1;
  try { mtime = fsSync.statSync(file).mtimeMs; } catch { return []; }
  if (_pinkieProjectRootsCache && _pinkieProjectRootsCache.file === file && _pinkieProjectRootsCache.mtime === mtime) return _pinkieProjectRootsCache.roots;
  let roots = [];
  try {
    const data = JSON.parse(fsSync.readFileSync(file, "utf8"));
    roots = Object.values(data || {}).flatMap((entry) => {
      const root = entry && typeof entry.root === "string" ? path.resolve(entry.root) : "";
      if (!root || root === path.parse(root).root || root === path.resolve(home)) return [];
      return [root];
    });
  } catch {}
  roots = [...new Set(roots)];
  _pinkieProjectRootsCache = { file, mtime, roots };
  return roots;
}
function _pinkieResolveExtraMediaRoots() {
  return [..._pinkieStaticMediaRoots(), ..._pinkieProjectRoots()];
}
function _pinkieStaticMediaRoots() {
  if (_pinkieExtraMediaRoots) return _pinkieExtraMediaRoots;
  const home = (os && typeof os.homedir === "function")
    ? os.homedir()
    : (process.env.HOME || process.env.USERPROFILE || "");
  const candidates = ["Desktop", "Downloads", "Documents", ".workbuddy", "WorkBuddy"];
  const list = [];
  for (const p of candidates) {
    try {
      const abs = path.resolve(path.join(home, p));
      if (abs && abs !== path.parse(abs).root) list.push(abs);
    } catch {}
  }
  _pinkieExtraMediaRoots = [...new Set([...list, ..._pinkieWorkspaceRoots(home)])];
  return _pinkieExtraMediaRoots;
}
function _pinkiePathIsUnderRoots(mediaPath, roots) {
  if (!mediaPath || !roots || !roots.length) return false;
  let resolved;
  try { resolved = path.resolve(mediaPath); } catch { return false; }
  const sep = path.sep;
  for (const root of roots) {
    if (resolved === root) return true;
    if (resolved.startsWith(root + sep)) return true;
  }
  return false;
}
/** Verifies that a local media path is managed inbound media or lives under allowed roots. */
async function assertLocalMediaAllowed(mediaPath, localRoots, options) {
	if (_pinkieDeniedMediaPath(mediaPath)) throw _pinkieDeniedError(mediaPath);
	if (localRoots === "any") return;
	if (await resolveInboundMediaReference(mediaPath).catch(() => null)) return;
	if (_pinkiePathIsUnderRoots(mediaPath, _pinkieResolveExtraMediaRoots())) return;
	try {
		assertNoWindowsNetworkPath(mediaPath, "Local media path");
	} catch (err) {
		throw new LocalMediaAccessError("network-path-not-allowed", err.message, { cause: err });
	}
	if (options?.inboundRoots?.length && isInboundPathAllowed({
		filePath: mediaPath,
		roots: options.inboundRoots
	})) return;
	const roots = localRoots ?? getDefaultLocalRoots();
	let resolved;
	try {
		resolved = await fs.realpath(mediaPath);
	} catch {
		resolved = path.resolve(mediaPath);
	}
	if (localRoots === void 0) {
		const workspaceRoot = roots.find((root) => path.basename(root) === "workspace");
		if (workspaceRoot) {
			const stateDir = path.dirname(workspaceRoot);
			const rel = path.relative(stateDir, resolved);
			if (rel && isPathInside(stateDir, resolved)) {
				if ((rel.split(path.sep)[0] ?? "").startsWith("workspace-")) throw new LocalMediaAccessError("path-not-allowed", `Local media path is not under an allowed directory: ${mediaPath}`);
			}
		}
	}
	const resolvedRoots = options?.resolvedRoots ?? await options?.resolveRoots?.() ?? await resolveLocalMediaRoots(roots);
	for (const [index, resolvedRoot] of resolvedRoots.entries()) {
		const root = roots[index] ?? resolvedRoot;
		if (resolvedRoot === path.parse(resolvedRoot).root) throw new LocalMediaAccessError("invalid-root", `Invalid localRoots entry (refuses filesystem root): ${root}. Pass a narrower directory.`);
		if (isPathInside(resolvedRoot, resolved)) return;
	}
	throw new LocalMediaAccessError("path-not-allowed", `Local media path is not under an allowed directory: ${mediaPath}`);
}
//#endregion
export { resolveLocalMediaRoots as i, assertLocalMediaAllowed as n, getDefaultLocalRoots as r, LocalMediaAccessError as t };
