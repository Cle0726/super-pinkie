/** Empty tool arrays are heartbeat metadata, not a boundary in thinking text.
 *
 * 2026.7 sealed the thinking block whenever `choiceDelta.tool_calls` was
 * present (`if (choiceDelta.tool_calls) {`). 2026.10 ships the stream in
 * `openai-completions-transport-*.mjs` and already requires a non-empty array
 * (`if (delta.tool_calls && delta.tool_calls.length > 0) {`), so the fix lives
 * upstream now; this module only keeps the legacy rewrite for old bundles.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const marker = '/* pinkie-work-thinking:v1 */';
const before = 'if (choiceDelta.tool_calls) {';
const after = `${marker}\n\t\t\t\t\tif (Array.isArray(choiceDelta.tool_calls) && choiceDelta.tool_calls.length > 0) {`;
const TARGET = /^openai-completions-[^.]+\.mjs$/;
const CURRENT = 'if (delta.tool_calls && delta.tool_calls.length > 0) {';

export function transform(source) {
  if (source.includes(marker)) return source;
  if (source.includes(CURRENT)) return source;
  if (source.split(before).length !== 2) throw new Error('OpenAI 思考解析结构已变化，未覆盖');
  return source.replace(before, after);
}

/** True when the 2026.10 transport already ignores empty tool arrays. */
export function isUpstreamFixed(source) {
  return !source.includes(marker) && source.split(CURRENT).length >= 2;
}

export function apply(root, {backupRoot} = {}) {
  const dir = path.join(root, 'node_modules/@openclaw/ai/dist');
  const names = fs.readdirSync(dir).filter(n => TARGET.test(n))
    .filter(n => {
      const s = fs.readFileSync(path.join(dir, n), 'utf8');
      return s.includes(before) || s.includes(marker) || isUpstreamFixed(s);
    });
  if (names.length !== 1) throw new Error('无法唯一确认 OpenAI 思考解析模块');
  const file = path.join(dir, names[0]), source = fs.readFileSync(file, 'utf8');
  if (isUpstreamFixed(source)) return {file, changed: false, upstream: true};
  const next = transform(source);
  if (next !== source) {
    if (backupRoot) {
      fs.mkdirSync(backupRoot, {recursive: true});
      const backup = path.join(backupRoot, names[0]);
      if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
    }
    const tmp = file + '.work-thinking';
    fs.writeFileSync(tmp, next, {mode: fs.statSync(file).mode});
    fs.renameSync(tmp, file);
  }
  return {file, changed: source !== next};
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (!process.env.OPENCLAW_ROOT) throw new Error('OPENCLAW_ROOT is required');
  console.log(JSON.stringify(apply(process.env.OPENCLAW_ROOT, {backupRoot: process.env.PINKIE_PATCH_BACKUP})));
}
