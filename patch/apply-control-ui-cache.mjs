/**
 * Let the App's web view reuse what it already has.
 *
 * OpenClaw serves every Control UI file with `Cache-Control: no-cache` and no
 * validator, so the web view had to download every file again on every
 * start: the app bundle, ~67 injected scripts (~2.3 MB), ~49 style sheets
 * (~1.1 MB) and the large mode/thinking art. Without a cached copy the
 * browser also cannot reuse its compiled-script cache, so all of it is
 * parsed and compiled again. On Windows (WebView2, often a slow disk and a
 * virus scanner on every read) that was a large part of a slow start.
 *
 * This keeps `no-cache` -- a new version is still picked up at once -- but
 * adds an ETag from the file's size and modification time and answers
 * `304 Not Modified` when the web view already holds that exact file. The
 * file is not even read in that case. Nothing about what is shown changes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const marker = "/* pinkie-control-ui-cache:v1 */";

// Kept as a string so tests can run exactly the code that gets injected.
export const helperSource = `${marker}
function pinkieRespondNotModified(req, res, fd) {
	let stat;
	try {
		stat = fs.fstatSync(fd);
	} catch {
		return false;
	}
	const etag = \`"pk-\${stat.size.toString(36)}-\${Math.floor(stat.mtimeMs).toString(36)}"\`;
	res.setHeader("ETag", etag);
	const header = req && req.headers ? req.headers["if-none-match"] : void 0;
	if (!header) return false;
	const matches = String(header).split(",").map((tag) => tag.trim()).some((tag) => tag === "*" || tag === etag || tag === \`W/\${etag}\`);
	if (!matches) return false;
	res.statusCode = 304;
	res.setHeader("Cache-Control", "no-cache");
	res.end();
	return true;
}
`;

const anchor = "function serveResolvedFile(res, filePath, body) {";
const call = "\t\tserveResolvedFile(res, safeFile.path, await readOpenedFile(safeFile.fd));\n\t\treturn true;";
const guardedCall = "\t\tif (pinkieRespondNotModified(req, res, safeFile.fd)) return true;\n" + call;

const replaceOnce = (text, from, to) => {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`Control UI 静态文件结构已变化（找到 ${count} 处），未覆盖: ${from.trim().slice(0, 80)}`);
  return text.replace(from, to);
};

export function transform(source) {
  if (source.includes(marker)) return source;
  let next = replaceOnce(source, anchor, `${helperSource}${anchor}`);
  next = replaceOnce(next, call, guardedCall);
  return next;
}

export function findChunk(dist) {
  const candidates = fs.readdirSync(dist).filter((name) => {
    if (!/^control-ui-[A-Za-z0-9_-]+\.(?:m?js)$/.test(name)) return false;
    const text = fs.readFileSync(path.join(dist, name), "utf8");
    return text.includes("function serveResolvedFile(") && text.includes("handleControlUiHttpRequest");
  });
  if (candidates.length !== 1) throw new Error(`无法唯一确认 control-ui 模块: ${candidates.join(", ")}`);
  return path.join(dist, candidates[0]);
}

export function apply(root) {
  const file = findChunk(path.join(root, "dist"));
  const source = fs.readFileSync(file, "utf8");
  const next = transform(source);
  if (next === source) return { changed: false, file: path.basename(file) };
  if (fs.readFileSync(file, "utf8") !== source) throw new Error("control-ui 模块正在被更新，未覆盖");
  fs.writeFileSync(file, next);
  return { changed: true, file: path.basename(file) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.OPENCLAW_ROOT;
  if (!root) throw new Error("请设置 OPENCLAW_ROOT 后重试");
  console.log(JSON.stringify(apply(root)));
}
