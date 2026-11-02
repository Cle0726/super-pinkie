/** chat.history keeps the user's words and a thumbnail for large images.
 *
 * Webchat stores a user's image inline (base64) in the transcript. The
 * transcript reader does not even parse lines over 256 KB and returns
 * "[chat.history omitted: message too large]" instead, so after the reply the
 * user's text and picture vanish from the chat. Two layers:
 *  - reader (session-utils.fs): an oversized *user* line is parsed once and kept
 *    without the inline image data (text, MediaPath and metadata stay);
 *  - chat.history: those images are re-read from their saved MediaPath (or the
 *    inline data when present) and shrunk to a thumbnail with OpenClaw's own
 *    image sanitizer, cached per message. If shrinking is unavailable the image
 *    is dropped and the text is kept. Transcripts on disk are never changed. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

export const marker = '/* pinkie-history-image-thumbnails:v1 */';
export const readerMarker = '/* pinkie-oversized-user-record:v1 */';
const anchor = '\tconst normalized = historyPage.messages;\n';

export function helperSource(toolImagesFile, exportName) {
  return `${marker}
const pinkieHistoryThumbCache = new Map();
async function pinkieImageBase64(block, message, index) {
\tif (typeof block.data === "string" && block.data) return block.data;
\tconst paths = Array.isArray(message.MediaPaths) ? message.MediaPaths : typeof message.MediaPath === "string" ? [message.MediaPath] : [];
\tconst file = paths[index];
\tif (typeof file !== "string") return null;
\tconst { promises: fsp } = await import("node:fs");
\tconst { homedir } = await import("node:os");
\tconst { resolve, sep } = await import("node:path");
\tconst real = await fsp.realpath(file).catch(() => null);
\tconst root = resolve(homedir(), ".openclaw", "media") + sep;
\tif (!real || !real.startsWith(root)) return null;
\tconst stat = await fsp.stat(real).catch(() => null);
\tif (!stat?.isFile() || stat.size > 32 * 1024 * 1024) return null;
\treturn (await fsp.readFile(real)).toString("base64");
}
async function pinkieThumbnailOversizedImages(messages, maxSingleMessageBytes) {
\tif (!Array.isArray(messages) || !messages.length) return messages;
\tlet changed = false;
\tconst out = [];
\tfor (const message of messages) {
\t\tconst content = message && typeof message === "object" && String(message.role || "").toLowerCase() === "user" && Array.isArray(message.content) ? message.content : null;
\t\tconst left = content?.some((block) => block?.type === "image" && block.pinkieDataOnDisk === true);
\t\tif (!content || !content.some((block) => block?.type === "image" && (typeof block.data === "string" || block.pinkieDataOnDisk === true)) || (!left && jsonUtf8Bytes(message) <= maxSingleMessageBytes)) {
\t\t\tout.push(message);
\t\t\tcontinue;
\t\t}
\t\tconst key = String(message.__openclaw?.id || message.idempotencyKey || message.__openclaw?.idempotencyKey || message.timestamp || "") + ":" + content.reduce((sum, block) => sum + (typeof block?.data === "string" ? block.data.length : 0), 0);
\t\tlet slim = pinkieHistoryThumbCache.get(key);
\t\tif (!slim) {
\t\t\tlet blocks = [];
\t\t\tlet imageIndex = 0;
\t\t\tfor (const block of content) {
\t\t\t\tif (block?.type !== "image") { blocks.push(block); continue; }
\t\t\t\tconst index = imageIndex++;
\t\t\t\ttry {
\t\t\t\t\tconst data = await pinkieImageBase64(block, message, index);
\t\t\t\t\tif (!data) continue;
\t\t\t\t\tconst { ${exportName}: sanitize } = await import("./${toolImagesFile}");
\t\t\t\t\tconst [thumb] = await sanitize([{ type: "image", data, mimeType: block.mimeType || "image/png" }], "chat.history", { maxDimensionPx: 640, maxBytes: 80 * 1024 });
\t\t\t\t\tif (thumb?.type === "image") blocks.push(thumb);
\t\t\t\t} catch {}
\t\t\t}
\t\t\tslim = { ...message, content: blocks, __openclaw: { ...message.__openclaw, pinkieImageThumbnail: true } };
\t\t\tif (pinkieHistoryThumbCache.size >= 64) pinkieHistoryThumbCache.delete(pinkieHistoryThumbCache.keys().next().value);
\t\t\tpinkieHistoryThumbCache.set(key, slim);
\t\t}
\t\tchanged = true;
\t\tout.push(slim);
\t}
\treturn changed ? out : messages;
}
`;
}

/** Reader side: an oversized user line keeps everything but its inline image data. */
export const readerHelper = `${readerMarker}
function pinkieSlimOversizedUserRecord(line) {
\tif (typeof line !== "string" || line.length > 48 * 1024 * 1024 || !line.includes('"role":"user"')) return null;
\tlet record;
\ttry { record = JSON.parse(line); } catch { return null; }
\tconst message = record?.message;
\tif (!record || typeof record !== "object" || Array.isArray(record) || !message || message.role !== "user" || !Array.isArray(message.content)) return null;
\tlet stripped = false;
\tconst content = message.content.map((block) => {
\t\tif (block?.type !== "image" || typeof block.data !== "string") return block;
\t\tstripped = true;
\t\treturn { type: "image", ...typeof block.mimeType === "string" ? { mimeType: block.mimeType } : {}, pinkieDataOnDisk: true };
\t});
\tif (!stripped) return null;
\tconst slim = { ...record, message: { ...message, content } };
\treturn Buffer.byteLength(JSON.stringify(slim), "utf8") <= 256 * 1024 ? slim : null;
}
`;

export function transformReader(original) {
  if (original.includes(readerMarker)) return original;
  const indexed = 'function buildOversizedIndexedRawEntry(params) {\n';
  const tail = 'function buildOversizedTranscriptRecord(line) {\n';
  if (original.split(indexed).length !== 2 || original.split(tail).length !== 2) throw new Error('OpenClaw 会话读取结构已变化，未覆盖：oversized transcript records');
  return original
    .replace(indexed, `${readerHelper}${indexed}\tconst pinkieSlim = pinkieSlimOversizedUserRecord(params.line);\n\tif (pinkieSlim) {\n\t\tconst pinkieTree = parseSessionTranscriptTreeEntry(pinkieSlim);\n\t\treturn {\n\t\t\t...typeof pinkieSlim.id === "string" ? { id: pinkieSlim.id } : {},\n\t\t\t...pinkieTree ? { parentId: pinkieTree.parentId } : {},\n\t\t\toffset: params.offset,\n\t\t\tbyteLength: params.byteLength,\n\t\t\trecord: pinkieSlim\n\t\t};\n\t}\n`)
    .replace(tail, `${tail}\tconst pinkieSlim = pinkieSlimOversizedUserRecord(line);\n\tif (pinkieSlim) return { record: pinkieSlim };\n`);
}

export function transform(original, toolImagesFile, exportName) {
  if (original.includes(marker)) return original;
  if (original.split(anchor).length !== 2) throw new Error('OpenClaw chat.history 结构已变化，未覆盖：history messages');
  if (!original.includes('function replaceOversizedChatHistoryMessages(')) throw new Error('OpenClaw chat.history 结构已变化，未覆盖：oversized replacement');
  const before = original.indexOf('function replaceOversizedChatHistoryMessages(');
  return original.slice(0, before) + helperSource(toolImagesFile, exportName) + original.slice(before)
    .replace(anchor, '\tconst normalized = await pinkieThumbnailOversizedImages(historyPage.messages, Math.min(CHAT_HISTORY_MAX_SINGLE_MESSAGE_BYTES, maxHistoryBytes));\n');
}

export function apply(root, {backupRoot} = {}) {
  const dist = path.join(root, 'dist');
  const names = fs.readdirSync(dist).filter((name) => name.endsWith('.js'));
  const find = (needle, label) => {
    const hits = names.filter((name) => fs.readFileSync(path.join(dist, name), 'utf8').includes(needle));
    if (hits.length !== 1) throw new Error('无法唯一确认 ' + label);
    return path.join(dist, hits[0]);
  };
  const chatFile = find('const CHAT_HISTORY_OVERSIZED_PLACEHOLDER', 'chat.history 模块');
  const readerFile = find('function buildOversizedIndexedRawEntry(params)', '会话读取模块');
  let toolImagesFile = '', exportName = '';
  for (const name of names.filter((value) => value.startsWith('tool-images-'))) {
    const match = /sanitizeContentBlocksImages as ([\w$]+)/.exec(fs.readFileSync(path.join(dist, name), 'utf8'));
    if (match) { toolImagesFile = name; exportName = match[1]; }
  }
  if (!toolImagesFile) throw new Error('无法找到 OpenClaw 图片缩放模块');
  // Validate both targets before writing either.
  const targets = [
    {file: chatFile, next: (text) => transform(text, toolImagesFile, exportName)},
    {file: readerFile, next: transformReader}
  ].map((target) => {
    const original = fs.readFileSync(target.file, 'utf8');
    return {...target, original, text: target.next(original)};
  });
  const changed = targets.filter((target) => target.text !== target.original);
  if (!changed.length) return {changed: false};
  const backup = backupRoot || path.join(os.homedir(), 'Library/Application Support/SuperPinkie/backups', 'history-thumbnails-' + Date.now());
  fs.mkdirSync(backup, {recursive: true, mode: 0o700});
  for (const target of changed) fs.copyFileSync(target.file, path.join(backup, path.basename(target.file)));
  for (const target of changed) if (fs.readFileSync(target.file, 'utf8') !== target.original) throw new Error('OpenClaw 模块正在被更新，未覆盖');
  for (const target of changed) fs.writeFileSync(target.file, target.text);
  return {changed: true, backup, files: changed.map((target) => path.basename(target.file))};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.OPENCLAW_ROOT;
  if (!root) throw new Error('请设置 OPENCLAW_ROOT');
  console.log(JSON.stringify(apply(root, {backupRoot: process.env.PINKIE_PATCH_BACKUP_ROOT || undefined})));
}
