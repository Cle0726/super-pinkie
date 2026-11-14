/* pinkie-media-inbox:v1 */
// Runtime helper for the `image` and `pdf` tools (installed next to OpenClaw's
// dist by patch/apply-image-access.mjs v5; the patched tool code imports it).
//
// * A file outside the allowed folders (/tmp, %TEMP%, the WeChat folder,
//   another mode's workspace…) is copied into the current mode workspace's
//   media/inbox/ and read from there. Copies older than 24 h are removed.
// * Credentials and keys are never read or copied (deniedMediaPath), on both
//   platforms' layouts, wherever they are asked for.
// * A PDF over the size cap: with `pages`, just those pages are split into a
//   small PDF first (PDFium from the runtime's own clawpdf, so Mac and Windows
//   behave the same and no Python is needed); without `pages`, the tool returns
//   the page count and outline as a normal result.
// * An image over the cap is shrunk, never refused: a GIF is sent as a still,
//   a data: URL is decoded past the cap and then shrunk like a file.
//
// No OpenClaw imports here: local-media-access imports deniedMediaPath, so a
// dependency back into OpenClaw would be a cycle. clawpdf is loaded lazily.
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";

export const INBOX_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 10 * 60 * 1000;
const MB = 1024 * 1024;
// The largest file copied into the inbox, and the largest PDF read in order to
// split pages or count them (OpenClaw's own document cap).
const STAGE_MAX_BYTES = 200 * MB;
export const PDF_READ_MAX_BYTES = 100 * MB;
// data: URL images are decoded up to this size and then shrunk under the cap.
const DATA_URL_MAX_BYTES = 50 * MB;
const OUTLINE_MAX_ENTRIES = 60;

// ---------- refused paths ----------

function pathApi(platform) { return platform === "win32" ? path.win32 : path.posix; }

function expandHome(value, home, P) {
  if (value === "~") return home;
  if (value.startsWith("~/") || value.startsWith("~\\")) return P.join(home, value.slice(2));
  return value;
}

/** Folders whose contents the media tools never read or copy, for this home / env / platform. */
export function deniedMediaRoots({env = process.env, home = os.homedir(), platform = process.platform} = {}) {
  const P = pathApi(platform);
  const roots = [];
  const add = (...parts) => {
    if (!parts.every((part) => typeof part === "string" && part)) return;
    roots.push(P.resolve(expandHome(P.join(...parts), home, P)));
  };
  // SSH keys and the macOS keychains.
  add(home, ".ssh");
  add(home, "Library", "Keychains");
  // Install config (provider ids, install paths) — PLAN: 「设定防护的私钥在这」.
  add(home, ".config", "super-pinkie");
  add(env.PINKIE_CONFIG_ROOT);
  // OpenClaw state: channel credentials and the device identity key pair.
  const stateDirs = [P.join(home, ".openclaw")];
  if (env.OPENCLAW_STATE_DIR) stateDirs.push(env.OPENCLAW_STATE_DIR);
  if (env.OPENCLAW_PROFILE) stateDirs.push(P.join(home, `.openclaw-${String(env.OPENCLAW_PROFILE).replace(/[\\/]+/g, "")}`));
  if (env.OPENCLAW_CONFIG_PATH) stateDirs.push(P.dirname(expandHome(env.OPENCLAW_CONFIG_PATH, home, P)));
  for (const dir of stateDirs) { add(dir, "credentials"); add(dir, "identity"); }
  // 碧琪's own state root: the settings guard's signed manifest and status.
  // Mac: ~/Library/Application Support/SuperPinkie; Windows: %LOCALAPPDATA%\SuperPinkie.
  const local = env.LOCALAPPDATA || P.join(home, "AppData", "Local");
  const roaming = env.APPDATA || P.join(home, "AppData", "Roaming");
  for (const root of [env.PINKIE_STATE_ROOT, P.join(home, "Library", "Application Support", "SuperPinkie"), P.join(local, "SuperPinkie")]) {
    add(root, "guard");
  }
  // Windows Credential Manager and DPAPI master keys.
  for (const base of [roaming, local]) for (const sub of ["Credentials", "Protect", "Vault"]) add(base, "Microsoft", sub);
  return [...new Set(roots)];
}

// macOS and Windows file systems are case-insensitive by default: compare folded.
function fold(value, platform) {
  const text = platform === "win32" ? value.replace(/\//g, "\\") : value;
  return text.toLowerCase();
}

function inside(root, file, P, platform) {
  const a = fold(root, platform), b = fold(file, platform);
  return b === a || b.startsWith(a.endsWith(P.sep) ? a : a + P.sep);
}

/** True when a media path (or what it links to) lies in a refused folder. */
export function deniedMediaPath(mediaPath, options = {}) {
  const platform = options.platform || process.platform;
  const P = pathApi(platform);
  const home = options.home || os.homedir();
  let raw = typeof mediaPath === "string" ? mediaPath.trim() : "";
  if (!raw) return false;
  if (/^file:\/\//i.test(raw)) { try { raw = fileURLToPath(raw, {windows: platform === "win32"}); } catch { return false; } }
  if (/^(?:https?|data|media):/i.test(raw)) return false;
  const roots = deniedMediaRoots({...options, home, platform});
  const candidates = [P.resolve(expandHome(raw, home, P))];
  if (platform === process.platform) { try { candidates.push(fs.realpathSync(candidates[0])); } catch {} }
  return candidates.some((file) => roots.some((root) => inside(root, file, P, platform)));
}

// ---------- the inbox ----------

/** Turns a tool's path argument into an absolute local path, or "" for URLs. */
export function localMediaPath(source, home = os.homedir()) {
  let raw = typeof source === "string" ? source.trim() : "";
  if (!raw || /^(?:https?|data|media):/i.test(raw)) return "";
  if (/^file:\/\//i.test(raw)) { try { raw = fileURLToPath(raw); } catch { return ""; } }
  return path.resolve(expandHome(raw, home, path));
}

export function inboxDir(workspaceDir) {
  return workspaceDir ? path.join(path.resolve(workspaceDir), "media", "inbox") : "";
}

const lastSweep = new Map();
/** Removes inbox copies not read for 24 hours. Throttled unless `force`. */
export function sweepInbox(dir, {now = Date.now(), maxAgeMs = INBOX_MAX_AGE_MS, force = false} = {}) {
  if (!dir) return [];
  if (!force && now - (lastSweep.get(dir) || 0) < SWEEP_EVERY_MS) return [];
  lastSweep.set(dir, now);
  const removed = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, {withFileTypes: true}); } catch { return removed; }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = path.join(dir, entry.name);
    try {
      if (now - fs.statSync(file).mtimeMs > maxAgeMs) { fs.rmSync(file, {force: true}); removed.push(file); }
    } catch {}
  }
  return removed;
}

function safeName(name) {
  const cleaned = String(name || "file").replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_").replace(/^\.+/, "").slice(-120);
  return cleaned || "file";
}

/**
 * Copies a local file into <workspace>/media/inbox and returns the copy's path,
 * or null when it must not or cannot be copied (refused folder, missing, not a
 * file, too large, no workspace). The same source reuses its copy and restarts
 * its 24 hours.
 */
export async function stageIntoInbox(source, {workspaceDir, now = Date.now(), home = os.homedir()} = {}) {
  const dir = inboxDir(workspaceDir);
  const file = localMediaPath(source, home);
  if (!dir || !file || deniedMediaPath(file, {home})) return null;
  let real, stat;
  try { real = await fsp.realpath(file); stat = await fsp.stat(real); } catch { return null; }
  if (!stat.isFile() || stat.size > STAGE_MAX_BYTES || deniedMediaPath(real, {home})) return null;
  if (inside(dir, real, path, process.platform)) return real;
  await fsp.mkdir(dir, {recursive: true});
  sweepInbox(dir, {now});
  const tag = crypto.createHash("sha1").update(`${real}\n${stat.size}\n${stat.mtimeMs}`).digest("hex").slice(0, 12);
  const target = path.join(dir, `${tag}-${safeName(path.basename(real))}`);
  const when = new Date(now);
  try {
    await fsp.utimes(target, when, when);
    return target;
  } catch {}
  const temp = `${target}.${process.pid}.part`;
  await fsp.copyFile(real, temp);
  await fsp.rename(temp, target);
  await fsp.utimes(target, when, when).catch(() => {});
  return target;
}

function isPathNotAllowed(err) {
  return err && err.code === "path-not-allowed";
}

async function withInbox(source, workspaceDir, load) {
  try {
    return {media: await load(source), source};
  } catch (err) {
    if (!isPathNotAllowed(err)) throw err;
    const staged = await stageIntoInbox(source, {workspaceDir});
    if (!staged) throw err;
    return {media: await load(staged), source: staged};
  }
}

// ---------- images ----------

const GIF_OVER_CAP = /^GIF exceeds \d+MB limit/;

/** Decoding cap for data: URL images; the decoded image is then shrunk. */
export function dataUrlReadCap(maxBytes) {
  return Math.max(Number(maxBytes) || 0, DATA_URL_MAX_BYTES);
}

/** Shrinks an image buffer under the cap; a GIF that is too big becomes a still. */
export async function optimizeImage(webMedia, params) {
  try {
    return await webMedia.optimizeImageBufferForWebMedia(params);
  } catch (err) {
    if (!GIF_OVER_CAP.test(String(err?.message || "")) || params.contentType !== "image/gif") throw err;
    return await webMedia.optimizeImageBufferForWebMedia({...params, contentType: "image/png"});
  }
}

/**
 * Loads one image for the image tool: copies it into the inbox when it is
 * outside the allowed folders, and shrinks a GIF over the cap to a still.
 */
export async function loadImage({source, workspaceDir, maxBytes, imageCompression, webMedia, load}) {
  let target = source, failure;
  try {
    return await load(target);
  } catch (err) {
    failure = err;
  }
  if (isPathNotAllowed(failure)) {
    const staged = await stageIntoInbox(source, {workspaceDir});
    if (!staged) throw failure;
    target = staged;
    try { return await load(staged); } catch (err) { failure = err; }
  }
  // A GIF over the cap: OpenClaw refuses it after the folder check passed, so
  // `target` (the original or its inbox copy) is a file it may read.
  const file = GIF_OVER_CAP.test(String(failure?.message || "")) ? localMediaPath(target) : "";
  if (!file) throw failure;
  const buffer = await fsp.readFile(file);
  return await optimizeImage(webMedia, {buffer, contentType: "image/gif", fileName: path.basename(file), maxBytes, imageCompression});
}

// ---------- PDFs ----------

/** Loads a PDF for the pdf tool, reading past the cap so a big one can be split or summarised. */
export async function loadPdf({source, workspaceDir, maxBytes, load}) {
  const cap = Math.max(Number(maxBytes) || 0, PDF_READ_MAX_BYTES);
  return (await withInbox(source, workspaceDir, (target) => load(target, cap))).media;
}

/**
 * OpenClaw's parsePageRange drops page numbers above pdfMaxPages (20), so
 * `pages: "25-28"` of a 30-page book matched nothing. Keep its result whenever
 * it matched; otherwise take the requested pages as they are, at most N of them.
 */
export function parsePages(raw, maxPages, parsePageRange) {
  try {
    return parsePageRange(raw, maxPages);
  } catch (err) {
    if (!/^No PDF pages matched/.test(String(err?.message || ""))) throw err;
    return parsePageRange(raw, Number.MAX_SAFE_INTEGER).slice(0, maxPages);
  }
}

let enginePromise;
async function pdfium() {
  enginePromise ||= import("clawpdf").then(({createEngine}) => createEngine()).catch((err) => { enginePromise = undefined; throw err; });
  const engine = await enginePromise;
  const m = engine?.module;
  for (const name of ["_FPDF_LoadMemDocument", "_FPDF_GetPageCount", "_FPDF_CloseDocument", "_FPDF_CreateNewDocument", "_FPDF_ImportPages", "_FPDF_SaveAsCopy", "_FPDFBookmark_GetFirstChild", "_FPDFBookmark_GetNextSibling", "_FPDFBookmark_GetTitle", "_FPDFBookmark_GetDest", "_FPDFDest_GetDestPageIndex", "addFunction", "removeFunction"]) {
    if (typeof m?.[name] !== "function") throw new Error(`clawpdf PDFium lacks ${name}`);
  }
  if (typeof m.wasmExports?.malloc !== "function" || !m.HEAPU8 || !m.HEAP32) throw new Error("clawpdf PDFium memory is not reachable");
  return m;
}

function cString(m, text) {
  const bytes = new TextEncoder().encode(`${text}\0`);
  const ptr = m.wasmExports.malloc(bytes.length);
  m.HEAPU8.set(bytes, ptr);
  return ptr;
}

async function openDocument(buffer, password) {
  const m = await pdfium();
  const dataPtr = m.wasmExports.malloc(buffer.length);
  m.HEAPU8.set(buffer, dataPtr);
  const passwordPtr = password ? cString(m, password) : 0;
  const doc = m._FPDF_LoadMemDocument(dataPtr, buffer.length, passwordPtr);
  if (!doc) {
    m.wasmExports.free(dataPtr);
    if (passwordPtr) m.wasmExports.free(passwordPtr);
    throw new Error("PDF could not be opened");
  }
  const close = () => {
    m._FPDF_CloseDocument(doc);
    m.wasmExports.free(dataPtr);
    if (passwordPtr) m.wasmExports.free(passwordPtr);
  };
  return {m, doc, close};
}

function bookmarkTitle(m, bookmark) {
  const size = m._FPDFBookmark_GetTitle(bookmark, 0, 0);
  if (size <= 2) return "";
  const ptr = m.wasmExports.malloc(size);
  try {
    m._FPDFBookmark_GetTitle(bookmark, ptr, size);
    return Buffer.from(m.HEAPU8.slice(ptr, ptr + size - 2)).toString("utf16le").replace(/\s+/g, " ").trim();
  } finally { m.wasmExports.free(ptr); }
}

function bookmarkPage(m, doc, bookmark) {
  let dest = m._FPDFBookmark_GetDest(doc, bookmark);
  if (!dest && typeof m._FPDFBookmark_GetAction === "function" && typeof m._FPDFAction_GetDest === "function") {
    const action = m._FPDFBookmark_GetAction(bookmark);
    if (action) dest = m._FPDFAction_GetDest(doc, action);
  }
  const index = dest ? m._FPDFDest_GetDestPageIndex(doc, dest) : -1;
  return index >= 0 ? index + 1 : 0;
}

function readOutline(m, doc) {
  const entries = [];
  const walk = (parent, depth) => {
    let child = m._FPDFBookmark_GetFirstChild(doc, parent);
    let guard = 0;
    while (child && entries.length < OUTLINE_MAX_ENTRIES && guard++ < 1000) {
      const title = bookmarkTitle(m, child);
      if (title) entries.push({title, page: bookmarkPage(m, doc, child), depth});
      if (depth < 1) walk(child, depth + 1);
      child = m._FPDFBookmark_GetNextSibling(doc, child);
    }
  };
  walk(0, 0);
  return entries;
}

/** Page count and top two outline levels of a PDF. */
export async function pdfInfo(buffer, {password} = {}) {
  const {m, doc, close} = await openDocument(buffer, password);
  try {
    return {pageCount: m._FPDF_GetPageCount(doc), outline: readOutline(m, doc)};
  } finally { close(); }
}

function rangeText(pages) {
  const parts = [];
  for (let i = 0; i < pages.length; i += 1) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j += 1;
    parts.push(j > i ? `${pages[i]}-${pages[j]}` : `${pages[i]}`);
    i = j;
  }
  return parts.join(",");
}

function saveDocument(m, doc) {
  const chunks = [];
  const writer = m.addFunction((_self, data, size) => { chunks.push(Buffer.from(m.HEAPU8.slice(data, data + size))); return 1; }, "iiii");
  const block = m.wasmExports.malloc(8);
  try {
    m.HEAP32[block >> 2] = 1;
    m.HEAP32[(block >> 2) + 1] = writer;
    if (!m._FPDF_SaveAsCopy(doc, block, 0)) throw new Error("PDF pages could not be saved");
    return Buffer.concat(chunks);
  } finally {
    m.wasmExports.free(block);
    m.removeFunction(writer);
  }
}

/** Copies the given 1-based pages of a PDF into a new, small PDF. */
export async function extractPdfPages(buffer, pages, {password} = {}) {
  const {m, doc, close} = await openDocument(buffer, password);
  try {
    const pageCount = m._FPDF_GetPageCount(doc);
    const wanted = [...new Set(pages)].filter((page) => Number.isInteger(page) && page >= 1 && page <= pageCount).sort((a, b) => a - b);
    if (!wanted.length) return {pageCount, pages: [], buffer: null};
    const out = m._FPDF_CreateNewDocument();
    const range = cString(m, rangeText(wanted));
    try {
      if (!m._FPDF_ImportPages(out, doc, range, 0)) throw new Error("PDF pages could not be copied");
      return {pageCount, pages: wanted, buffer: saveDocument(m, out)};
    } finally {
      m.wasmExports.free(range);
      m._FPDF_CloseDocument(out);
    }
  } finally { close(); }
}

function megabytes(bytes) {
  return (bytes / MB).toFixed(1).replace(/\.0$/, "");
}

/** PLAN §5 text (Fable's wording — do not rewrite). */
export function overviewText({pageCount, sizeBytes, maxPages, outline = []}) {
  let text = `这份 PDF 有 ${pageCount} 页、${megabytes(sizeBytes)} MB，太大了没法整本读。请用 pages 指定要读的页，一次最多 ${maxPages} 页。`;
  if (outline.length) {
    // 待 Fable 写：目录条目的排法（这里先用「标题（第 N 页）」，二级缩进两格）。
    text += "目录如下：\n" + outline.map(({title, page, depth}) => `${"  ".repeat(depth)}- ${title}${page ? `（第 ${page} 页）` : ""}`).join("\n");
  }
  return text;
}

/** 待 Fable 写：抽出来的页仍超上限、只送了前面几页时，加在结果前面的一句。 */
export function partialPagesNote(sent, asked) {
  return `（PDF 太大，这次只读了第 ${rangeText(sent)} 页；第 ${rangeText(asked.filter((page) => !sent.includes(page)))} 页请再用 pages 分开读。）`;
}

/**
 * Called by the pdf tool after a PDF was loaded. Under the cap: null (nothing
 * changes). Over the cap without pages: {overview} — a normal tool result.
 * With pages: {buffer, pages, note?} — a small PDF holding just those pages
 * (trailing pages dropped until it fits, with a note saying which were sent).
 */
export async function fitPdf({media, maxBytes, pageNumbers, maxPages, password, source}) {
  const size = media?.buffer?.length || 0;
  if (!size || size <= maxBytes) return null;
  // OpenClaw's own wording for a file over the cap (web-media formatCapLimit):
  // used only when nothing smaller could be made, so an over-cap PDF is never sent.
  const capError = (got) => new Error(`Media exceeds ${megabytes(maxBytes)}MB limit (got ${(got / MB).toFixed(2)}MB)`);
  const overview = async () => {
    const info = await pdfInfo(media.buffer, {password});
    return {overview: {
      content: [{type: "text", text: overviewText({pageCount: info.pageCount, sizeBytes: size, maxPages, outline: info.outline})}],
      details: {pdf: source, pageCount: info.pageCount, sizeMb: Number(megabytes(size)), maxPages, outline: info.outline.length, needsPages: true},
    }};
  };
  try {
    if (!pageNumbers?.length) return await overview();
    let result = await extractPdfPages(media.buffer, pageNumbers.slice(0, maxPages), {password});
    // None of the asked pages exist: say how many there are instead.
    if (!result.buffer) return await overview();
    const asked = result.pages;
    let pages = asked;
    while (result.buffer.length > maxBytes && pages.length > 1) {
      pages = pages.slice(0, Math.max(1, Math.floor(pages.length * Math.min(0.9, maxBytes / result.buffer.length))));
      result = await extractPdfPages(media.buffer, pages, {password});
    }
    if (result.buffer.length > maxBytes) throw capError(result.buffer.length);
    return {buffer: result.buffer, pages, ...(pages.length < asked.length ? {note: partialPagesNote(pages, asked)} : {})};
  } catch (err) {
    if (/^Media exceeds/.test(String(err?.message || ""))) throw err;
    // PDFium unavailable or the file is damaged: refuse exactly as before.
    throw capError(size);
  }
}
