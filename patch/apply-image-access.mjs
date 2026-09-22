/**
 * Pinkie image-access patch.
 *
 * Adds an early-return allowlist check to OpenClaw's
 * `assertLocalMediaAllowed()` so local files under common user
 * directories (~/Desktop, ~/Downloads, ~/Documents, ~/.workbuddy,
 * ~/WorkBuddy, and the user's explicit ~/.openclaw/workspace* directories)
 * can be displayed inside the control UI without
 * tripping "Outside allowed folders" (`path-not-allowed`).
 *
 * The patch is idempotent (guarded by a marker comment) and version-
 * checked: if the upstream code layout changes, the script refuses to
 * patch rather than silently corrupting the bundle.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const marker = "/* pinkie-image-access:v3 */";
const legacyMarker = "/* pinkie-image-access:v1 */";
const previousMarker = "/* pinkie-image-access:v2 */";

/**
 * Header injected at the very top of the patched dist file.
 * Imports `os` and the synchronous directory reader. The source module already
 * imports `path` and `fs/promises`; this separate reader is used only once to
 * enumerate specific workspace directories, never the whole state directory.
 */
const header = marker + '\nimport os from "node:os";\nimport fsSync from "node:fs";\n';

/**
 * Helper functions injected near the top of the file. They expose:
 *   _pinkieResolveExtraMediaRoots(): returns exact absolute media roots, cached.
 *   _pinkiePathIsUnderRoots(p, roots): pure membership test.
 * Designed to be tiny and side-effect free — runs once per call.
 */
const helpers = `
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
function _pinkieResolveExtraMediaRoots() {
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
`;

/**
 * Throw if the snippet matches more than once — protects against silently
 * patching the wrong location after an upstream reshape.
 */
function replaceOnce(text, from, to) {
  if (text.split(from).length !== 2) {
    throw new Error("OpenClaw 图片白名单代码结构已变化，未覆盖: " + from.slice(0, 90));
  }
  return text.replace(from, to);
}

/**
 * Apply the transform to a single dist file's source.
 * Returns the new source (or the original if already patched).
 */
export function transform(original) {
  if (original.includes(marker)) return original;

  /* v2 had the right exact workspace list but only applied it to callers that
     omitted localRoots. Control UI supplies an agent-scoped root array, so its
     media endpoint still rejected a valid workspace-project path. Retain the
     same narrow roots, but apply them before either default or explicit root
     resolution. */
  if (original.includes(previousMarker)) {
    const oldCheck = '\tif (localRoots === void 0 && _pinkiePathIsUnderRoots(mediaPath, _pinkieResolveExtraMediaRoots())) return;\n';
    const newCheck = '\tif (_pinkiePathIsUnderRoots(mediaPath, _pinkieResolveExtraMediaRoots())) return;\n';
    return original
      .replace(previousMarker, marker)
      .replace(oldCheck, newCheck);
  }
  let text = original;

  /* v1 ran in real installs but did not include ~/.openclaw/workspace-*.
     Remove only our own v1 envelope, then apply the v2 transform cleanly. */
  if (text.includes(legacyMarker)) {
    const doc = "/** Verifies that a local media path is managed inbound media or lives under allowed roots. */\n";
    const helperStart = "let _pinkieExtraMediaRoots;\n";
    text = text.replace(legacyMarker + '\nimport os from "node:os";\n', "");
    const start = text.indexOf(helperStart);
    const end = text.indexOf(doc, start);
    if (start < 0 || end < 0) throw new Error("旧版图片白名单代码结构已变化，未覆盖");
    text = text.slice(0, start) + text.slice(end);
    text = text.replace(
      '\tif (localRoots === void 0 && _pinkiePathIsUnderRoots(mediaPath, _pinkieResolveExtraMediaRoots())) return;\n',
      ""
    );
  }

  // Inject helper functions right before the assertLocalMediaAllowed
  // declaration. We anchor on the doc-comment + signature so this
  // stays stable across cosmetic reshuffles.
  const anchorFrom =
    "/** Verifies that a local media path is managed inbound media or lives under allowed roots. */\n" +
    "async function assertLocalMediaAllowed(";
  const anchorTo =
    helpers.trimStart() +
    "/** Verifies that a local media path is managed inbound media or lives under allowed roots. */\n" +
    "async function assertLocalMediaAllowed(";
  text = replaceOnce(text, anchorFrom, anchorTo);

  // Add only exact user workspace directories. This must happen for both
  // default and agent-scoped roots: Control UI supplies the latter even though
  // the agent is deliberately allowed to render its own project output.
  // OpenClaw 2026.9 moved some callers into resolveLocalMediaBoundary, so
  // retain that path too and leave its realpath/boundary checks intact.
  const inboundFrom =
    '\tif (await resolveInboundMediaReference(mediaPath).catch(() => null)) return;\n';
  const inboundTo =
    '\tif (await resolveInboundMediaReference(mediaPath).catch(() => null)) return;\n' +
    '\tif (_pinkiePathIsUnderRoots(mediaPath, _pinkieResolveExtraMediaRoots())) return;\n';
  const boundaryFrom =
    '\tconst roots = localRoots ?? getDefaultLocalRootsCore();\n' +
    '\tconst resolved = await resolveLocalMediaPathForContainment(mediaPath);\n';
  const boundaryTo =
    '\tconst roots = [...(localRoots ?? getDefaultLocalRootsCore()), ..._pinkieResolveExtraMediaRoots()];\n' +
    '\tconst resolved = await resolveLocalMediaPathForContainment(mediaPath);\n';
  if (text.split(inboundFrom).length === 2) text = text.replace(inboundFrom, inboundTo);
  else if (text.split(boundaryFrom).length === 2) text = text.replace(boundaryFrom, boundaryTo);
  else throw new Error("OpenClaw 图片白名单代码结构已变化，未覆盖: inbound/boundary roots");

  return header + text;
}

/**
 * Discover the dist/local-media-access-*.js file inside an OpenClaw
 * install, apply the patch atomically, and back up the original.
 */
export function apply(root, { backupRoot } = {}) {
  const dist = path.join(root, "dist");
  const candidates = fs.readdirSync(dist).filter(
    (n) => n.startsWith("local-media-access-") && n.endsWith(".js")
  );
  if (candidates.length !== 1) {
    throw new Error("无法唯一确认 local-media-access 模块: " + candidates.join(", "));
  }
  const file = path.join(dist, candidates[0]);
  const original = fs.readFileSync(file, "utf8");
  const next = transform(original);
  if (original === next) return { changed: false };

  // Validate that nothing else is mid-write before we touch the file.
  if (fs.readFileSync(file, "utf8") !== original) {
    throw new Error("local-media-access 模块正在被更新，未覆盖");
  }

  const backup =
    backupRoot ||
    path.join(
      os.homedir(),
      "Library/Application Support/SuperPinkie/backups",
      "image-access-" + Date.now()
    );
  fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
  fs.copyFileSync(file, path.join(backup, candidates[0]));

  fs.writeFileSync(file, next);
  return { changed: true, backup, file: candidates[0] };
}

// CLI entry — mirrors apply-context-budget.mjs so apply-theme.sh can
// drive it the same way (OPENCLAW_ROOT env var, single JSON line out).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let root = process.env.OPENCLAW_ROOT;
  if (!root) {
    const entries = execFileSync(
      process.platform === "win32" ? "where" : "which",
      ["openclaw"],
      { encoding: "utf8" }
    ).trim().split(/\r?\n/);
    for (const entry of entries) {
      const dir = path.dirname(fs.realpathSync(entry));
      root = [dir, path.join(dir, "node_modules/openclaw")].find((candidate) =>
        fs.existsSync(path.join(candidate, "dist"))
      );
      if (root) break;
    }
  }
  if (!root) throw new Error("无法找到 OpenClaw 包目录，请明确设置 OPENCLAW_ROOT");
  console.log(JSON.stringify(apply(root, {
    backupRoot: process.env.PINKIE_PATCH_BACKUP_ROOT || undefined,
  })));
}
