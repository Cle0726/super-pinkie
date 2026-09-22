/**
 * Permit the desktop shell's opaque local-material URL only where it is
 * needed by the Control UI.  Gateway HTML is protected by a strict CSP; a
 * WKURLSchemeHandler alone is therefore not enough for an <img> or <iframe>
 * to load `clekk-material:`.  This patch is deliberately narrow: it does not
 * enable arbitrary network sources and it does not change agent permissions.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const marker = "/* pinkie-material-preview-csp:v1 */";
const imageSource = '"img-src \'self\' data: blob:",';
const frameSource = '"media-src \'self\' data: blob:",';
const imageReplacement = '"img-src \'self\' data: blob: clekk-material:",';
const frameReplacement = '"media-src \'self\' data: blob:",\n\t\t"frame-src \'self\' data: clekk-material:",';

const replaceOnce = (text, from, to) => {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`Control UI CSP 结构已变化，未覆盖: ${from}`);
  return text.replace(from, to);
};

export function transform(source) {
  if (source.includes(marker)) return source;
  let next = source;
  next = replaceOnce(next, imageSource, imageReplacement);
  next = replaceOnce(next, frameSource, frameReplacement);
  return `${marker}\n${next}`;
}

export function apply(root) {
  const dist = path.join(root, "dist");
  const candidates = fs.readdirSync(dist).filter((name) => {
    if (!/^control-ui-[A-Za-z0-9_-]+\.js$/.test(name)) return false;
    return fs.readFileSync(path.join(dist, name), "utf8").includes("buildControlUiCspHeader");
  });
  if (candidates.length !== 1) throw new Error(`无法唯一确认 control-ui 模块: ${candidates.join(", ")}`);
  const file = path.join(dist, candidates[0]);
  const source = fs.readFileSync(file, "utf8");
  const next = transform(source);
  if (source === next) return { changed: false, file: candidates[0] };
  if (fs.readFileSync(file, "utf8") !== source) throw new Error("control-ui 模块正在被更新，未覆盖");
  fs.writeFileSync(file, next);
  return { changed: true, file: candidates[0] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.OPENCLAW_ROOT;
  if (!root) throw new Error("请设置 OPENCLAW_ROOT 后重试");
  console.log(JSON.stringify(apply(root)));
}
