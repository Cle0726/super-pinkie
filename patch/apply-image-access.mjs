/**
 * Pinkie image-access patch.
 *
 * v5 (tools-health 11-13, A4) also installs dist/pinkie-media-inbox.mjs and
 * patches the image / pdf tools: files outside the allowed folders are read
 * through the mode workspace's media/inbox (kept 24 h), credentials and keys
 * stay refused, a PDF over the cap is split by pages or summarised, and an
 * image over the cap is shrunk instead of refused.
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
const v4Marker = "/* pinkie-image-access:v4 */";
const marker = "/* pinkie-image-access:v5 */";
const legacyMarker = "/* pinkie-image-access:v1 */";
const previousMarker = "/* pinkie-image-access:v2 */";
const v3Marker = "/* pinkie-image-access:v3 */";

/* v4: a project folder the user bound (project-scope bindings.json) is where
   碧琪 builds and screenshots the work. v3 only allowed Desktop / Downloads /
   Documents / workspaces, so a project at e.g. ~/Projects/shop or D:\\work could
   be written and screenshotted but not looked at: the image tool refused the
   screenshot, the delivery check kept saying "the page was never viewed", and
   the tier ran to its continuation limit (11-11 hy4free ladder-r7, L3-a / L6).
   Bound roots are read on every check (bindings change while the gateway runs),
   cached by the file's mtime. project-scope already refuses the home folder,
   drive roots and its own state folder as a project root. */
const v3RootsHead = "function _pinkieResolveExtraMediaRoots() {\n  if (_pinkieExtraMediaRoots) return _pinkieExtraMediaRoots;\n";
const v4RootsHead = "function _pinkieStaticMediaRoots() {\n  if (_pinkieExtraMediaRoots) return _pinkieExtraMediaRoots;\n";
const projectRootsHelpers = `let _pinkieProjectRootsCache;
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
`;

function toV4(text) {
  if (text.split(v3RootsHead).length !== 2) throw new Error("图片白名单 v3 结构已变化，未覆盖");
  return text.replace(v3Marker, v4Marker).replace(v3RootsHead, projectRootsHelpers + v4RootsHead);
}

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
  return toV5(transformV4(original));
}

export function transformV4(original) {
  if (original.includes(v4Marker)) return original;
  if (original.includes(v3Marker)) return toV4(original);

  /* v2 had the right exact workspace list but only applied it to callers that
     omitted localRoots. Control UI supplies an agent-scoped root array, so its
     media endpoint still rejected a valid workspace-project path. Retain the
     same narrow roots, but apply them before either default or explicit root
     resolution. */
  if (original.includes(previousMarker)) {
    const oldCheck = '\tif (localRoots === void 0 && _pinkiePathIsUnderRoots(mediaPath, _pinkieResolveExtraMediaRoots())) return;\n';
    const newCheck = '\tif (_pinkiePathIsUnderRoots(mediaPath, _pinkieResolveExtraMediaRoots())) return;\n';
    return toV4(original
      .replace(previousMarker, v3Marker)
      .replace(oldCheck, newCheck));
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
  // 2026.10: the managed-reference lookup is wrapped in try/catch and the
  // defaults come from getDefaultMediaLocalRoots(). Keep the inbound branch as
  // is (it already narrows to the physical file) and widen only the boundary
  // roots, which is what the Control UI's agent-scoped roots are compared to.
  const currentInboundFrom =
    '\tlet inboundReference;\n' +
    '\ttry {\n' +
    '\t\tinboundReference = await resolveInboundMediaReference(mediaPath);\n';
  const currentInboundTo =
    '\tif (_pinkiePathIsUnderRoots(mediaPath, _pinkieResolveExtraMediaRoots())) return {\n' +
    '\t\trejectHardlinks: false,\n' +
    '\t\troots: [path.dirname(path.resolve(mediaPath))]\n' +
    '\t};\n' +
    currentInboundFrom;
  const currentBoundaryFrom =
    '\tconst roots = localRoots ?? getDefaultMediaLocalRoots();\n' +
    '\tconst resolved = await resolveLocalMediaPathForContainment(mediaPath);\n';
  const currentBoundaryTo =
    '\tconst roots = [...(localRoots ?? getDefaultMediaLocalRoots()), ..._pinkieResolveExtraMediaRoots()];\n' +
    '\tconst resolved = await resolveLocalMediaPathForContainment(mediaPath);\n';
  // Every known caller shape is widened, not just the first one found: the
  // managed-reference lookup and the default-root boundary are separate paths.
  const shapes = [];
  if (text.split(inboundFrom).length === 2) shapes.push([inboundFrom, inboundTo]);
  if (text.split(currentInboundFrom).length === 2) shapes.push([currentInboundFrom, currentInboundTo]);
  if (text.split(boundaryFrom).length === 2) shapes.push([boundaryFrom, boundaryTo]);
  if (text.split(currentBoundaryFrom).length === 2) shapes.push([currentBoundaryFrom, currentBoundaryTo]);
  for (const [from, to] of shapes) text = text.replace(from, to);
  if (!shapes.length) throw new Error("OpenClaw 图片白名单代码结构已变化，未覆盖: inbound/boundary roots");

  return toV4(v3Marker + header.slice(marker.length) + text);
}

/* v5 (tools-health 11-13, A4): credentials and keys are refused even when a
   bound project or an explicit localRoots entry would contain them, and the
   image / pdf tools read files from anywhere else through the mode workspace's
   media/inbox (patch/pinkie-media-inbox.mjs, installed next to the dist). */
const v5Import = 'import { deniedMediaPath as _pinkieDeniedMediaPath } from "./pinkie-media-inbox.mjs";\n';
const v5Helpers = `function _pinkieDeniedError(mediaPath) {
\tconst message = \`Local media path is not under an allowed directory: \${mediaPath}\`;
\tif (typeof LocalMediaAccessError === "function") return new LocalMediaAccessError("path-not-allowed", message);
\treturn Object.assign(new Error(message), { code: "path-not-allowed" });
}
`;
const v5Check = '\tif (_pinkieDeniedMediaPath(mediaPath)) throw _pinkieDeniedError(mediaPath);\n';

function toV5(text) {
  if (text.includes(marker)) return text;
  if (text.split(v4Marker).length !== 2) throw new Error("图片白名单 v4 结构已变化，未覆盖");
  let next = text.replace(v4Marker + "\n", marker + "\n" + v5Import);
  // Refuse first, in every entry point that decides a local media path.
  let hits = 0;
  next = next.replace(/((?:async )?function (?:assertLocalMediaAllowed|resolveLocalMediaBoundary)\(mediaPath[^)]*\) \{\n)/gu, (head) => {
    hits += 1;
    return head + v5Check;
  });
  if (!hits) throw new Error("OpenClaw 图片白名单代码结构已变化，未覆盖: 拒绝目录");
  const helperAnchor = "let _pinkieExtraMediaRoots;\n";
  if (next.split(helperAnchor).length !== 2) throw new Error("图片白名单 v4 结构已变化，未覆盖: helpers");
  return next.replace(helperAnchor, v5Helpers + helperAnchor);
}

/* The image and pdf tools (OpenClaw 2026.7: openclaw-tools-*.js). Each edit is
   matched exactly once or the patch refuses, like the boundary patch above. */
const toolsMarker = "/* pinkie-media-tools:v1 */";
const toolsHeader = toolsMarker + '\nimport * as _pinkieMediaInbox from "./pinkie-media-inbox.mjs";\n';
export const toolEdits = [
  // image: a data: URL over the cap is decoded anyway and then shrunk.
  [
    "\t\t\t\t\tconst decoded = decodeDataUrl(resolvedImage, { maxBytes });\n\t\t\t\t\treturn await imageWebMedia.optimizeImageBufferForWebMedia({\n",
    "\t\t\t\t\tconst decoded = decodeDataUrl(resolvedImage, { maxBytes: _pinkieMediaInbox.dataUrlReadCap(maxBytes) });\n\t\t\t\t\treturn await _pinkieMediaInbox.optimizeImage(imageWebMedia, {\n",
  ],
  // image: outside the allowed folders → inbox copy; a GIF over the cap → still.
  [
    "\t\t\t\t}) : await imageWebMedia.loadWebMedia(resolvedPath ?? resolvedImage, {\n\t\t\t\t\tmaxBytes,\n\t\t\t\t\tlocalRoots: mediaLocalRoots,\n\t\t\t\t\tinboundRoots: mediaInboundRoots,\n\t\t\t\t\tssrfPolicy: remoteMediaSsrfPolicy,\n\t\t\t\t\t...isHttpUrl ? { readIdleTimeoutMs: REMOTE_MEDIA_READ_IDLE_TIMEOUT_MS } : {},\n\t\t\t\t\timageCompression\n\t\t\t\t});\n\t\t\t\tif (media.kind !== \"image\")",
    "\t\t\t\t}) : await _pinkieMediaInbox.loadImage({ source: resolvedPath ?? resolvedImage, workspaceDir: options?.workspaceDir, maxBytes, imageCompression, webMedia: imageWebMedia, load: (_pinkieSource) => imageWebMedia.loadWebMedia(_pinkieSource, {\n\t\t\t\t\tmaxBytes,\n\t\t\t\t\tlocalRoots: mediaLocalRoots,\n\t\t\t\t\tinboundRoots: mediaInboundRoots,\n\t\t\t\t\tssrfPolicy: remoteMediaSsrfPolicy,\n\t\t\t\t\t...isHttpUrl ? { readIdleTimeoutMs: REMOTE_MEDIA_READ_IDLE_TIMEOUT_MS } : {},\n\t\t\t\t\timageCompression\n\t\t\t\t}) });\n\t\t\t\tif (media.kind !== \"image\")",
  ],
  // pdf: pages above pdfMaxPages (20) used to match nothing.
  [
    "\t\t\tconst pageNumbers = pagesRaw ? parsePageRange(pagesRaw, configuredMaxPages) : void 0;\n",
    "\t\t\tconst pageNumbers = pagesRaw ? _pinkieMediaInbox.parsePages(pagesRaw, configuredMaxPages, parsePageRange) : void 0;\n",
  ],
  // pdf: outside the allowed folders → inbox copy; read past the cap so a big
  // one can be split (with pages) or summarised (without).
  [
    "\t\t\t\t}) : await loadWebMediaRaw(resolvedPathInfo.resolved, {\n\t\t\t\t\tmaxBytes,\n\t\t\t\t\tlocalRoots,\n\t\t\t\t\t...isHttpUrl ? { readIdleTimeoutMs: REMOTE_MEDIA_READ_IDLE_TIMEOUT_MS } : {},\n\t\t\t\t\tssrfPolicy: remoteMediaSsrfPolicy\n\t\t\t\t});\n",
    "\t\t\t\t}) : await _pinkieMediaInbox.loadPdf({ source: resolvedPathInfo.resolved, workspaceDir: options?.workspaceDir, maxBytes, load: (_pinkieSource, _pinkieCap) => loadWebMediaRaw(_pinkieSource, {\n\t\t\t\t\tmaxBytes: _pinkieCap,\n\t\t\t\t\tlocalRoots,\n\t\t\t\t\t...isHttpUrl ? { readIdleTimeoutMs: REMOTE_MEDIA_READ_IDLE_TIMEOUT_MS } : {},\n\t\t\t\t\tssrfPolicy: remoteMediaSsrfPolicy\n\t\t\t\t}) });\n",
  ],
  [
    "\t\t\t\tconst base64 = media.buffer.toString(\"base64\");\n",
    "\t\t\t\tconst _pinkieFit = await _pinkieMediaInbox.fitPdf({ media, maxBytes, pageNumbers, maxPages: configuredMaxPages, password, source: resolvedPathInfo.resolved });\n\t\t\t\tif (_pinkieFit?.overview) return _pinkieFit.overview;\n\t\t\t\tconst _pinkieBuffer = _pinkieFit?.buffer ?? media.buffer;\n\t\t\t\tconst base64 = _pinkieBuffer.toString(\"base64\");\n",
  ],
  [
    "\t\t\t\t\tbuffer: media.buffer,\n\t\t\t\t\tfilename,\n\t\t\t\t\tresolvedPath: resolvedPathInfo.resolved,\n",
    "\t\t\t\t\tbuffer: _pinkieBuffer,\n\t\t\t\t\tpinkiePages: _pinkieFit?.pages,\n\t\t\t\t\tpinkieNote: _pinkieFit?.note,\n\t\t\t\t\tfilename,\n\t\t\t\t\tresolvedPath: resolvedPathInfo.resolved,\n",
  ],
  // A split PDF already holds just the asked pages: read all of it.
  [
    "\t\t\t\t\t\tpageNumbers,\n\t\t\t\t\t\tconfig: options?.config\n",
    "\t\t\t\t\t\tpageNumbers: pdf.pinkiePages ? void 0 : pageNumbers,\n\t\t\t\t\t\tconfig: options?.config\n",
  ],
  [
    "\t\t\t\t...password ? { password } : {},\n\t\t\t\tpageNumbers,\n\t\t\t\tgetExtractions\n\t\t\t});\n",
    "\t\t\t\t...password ? { password } : {},\n\t\t\t\tpageNumbers: loadedPdfs.every((p) => p.pinkiePages) ? void 0 : pageNumbers,\n\t\t\t\tgetExtractions\n\t\t\t});\n\t\t\tconst _pinkieNotes = loadedPdfs.map((p) => p.pinkieNote).filter(Boolean);\n\t\t\tif (_pinkieNotes.length && typeof result?.text === \"string\") result.text = _pinkieNotes.join(\"\\n\") + \"\\n\\n\" + result.text;\n",
  ],
];

/** Patches OpenClaw's image and pdf tool source (openclaw-tools-*.js). */
export function transformTools(original) {
  if (original.includes(toolsMarker)) return original;
  let text = original;
  for (const [from, to] of toolEdits) {
    if (text.split(from).length !== 2) throw new Error("OpenClaw image/pdf 工具代码结构已变化，未覆盖: " + from.trim().slice(0, 90));
    text = text.replace(from, () => to);
  }
  return toolsHeader + text;
}

/** The runtime helper both patched files import, as installed into dist/. */
export const helperName = "pinkie-media-inbox.mjs";
export function helperSource() {
  return fs.readFileSync(path.join(here, helperName), "utf8");
}

function uniqueDistFile(dist, label, test) {
  const hits = fs.readdirSync(dist)
    .filter((n) => /\.m?js$/.test(n) && test(n));
  if (hits.length !== 1) throw new Error(`无法唯一确认 ${label} 模块: ` + hits.join(", "));
  return hits[0];
}

/**
 * Discover the dist/local-media-access-*.js file and the image/pdf tool chunk
 * inside an OpenClaw install, install the helper next to them, patch both,
 * and back up what was there.
 */
export function apply(root, { backupRoot } = {}) {
  const dist = path.join(root, "dist");
  // 2026.10 emits .mjs bundles (one is only a re-export shim), 2026.7 used
  // .js; pick the single chunk that actually implements the boundary
  // (2026.10: resolveLocalMediaBoundary, 2026.7: assertLocalMediaAllowed).
  const accessName = uniqueDistFile(dist, "local-media-access", (n) => {
    if (!n.startsWith("local-media-access-")) return false;
    const source = fs.readFileSync(path.join(dist, n), "utf8");
    return source.includes(marker)
      || /function resolveLocalMediaBoundary\(/u.test(source)
      || /function assertLocalMediaAllowed\(/u.test(source);
  });
  const toolsName = uniqueDistFile(dist, "image/pdf 工具", (n) => {
    if (n.startsWith("pinkie-")) return false;
    const source = fs.readFileSync(path.join(dist, n), "utf8");
    return source.includes("function createPdfTool(") && source.includes("function createImageTool(");
  });
  const plan = [
    [helperName, fs.existsSync(path.join(dist, helperName)) ? fs.readFileSync(path.join(dist, helperName), "utf8") : null, helperSource()],
  ];
  for (const [name, fn] of [[accessName, transform], [toolsName, transformTools]]) {
    const original = fs.readFileSync(path.join(dist, name), "utf8");
    plan.push([name, original, fn(original)]);
  }
  const changed = plan.filter(([, before, after]) => before !== after);
  if (!changed.length) return { changed: false };

  // Validate that nothing else is mid-write before we touch the files.
  for (const [name, before] of changed) {
    if (before !== null && fs.readFileSync(path.join(dist, name), "utf8") !== before) {
      throw new Error(name + " 正在被更新，未覆盖");
    }
  }

  const backup =
    backupRoot ||
    path.join(
      os.homedir(),
      "Library/Application Support/SuperPinkie/backups",
      "image-access-" + Date.now()
    );
  fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
  // The helper first: both patched files import it.
  for (const [name, before, after] of changed) {
    if (before !== null) fs.copyFileSync(path.join(dist, name), path.join(backup, name));
    fs.writeFileSync(path.join(dist, name), after);
  }
  return { changed: true, backup, files: changed.map(([name]) => name), file: accessName };
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
