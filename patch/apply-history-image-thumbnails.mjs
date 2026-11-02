/** chat.history keeps the user's words and a thumbnail for large images.
 *
 * Webchat stores a user's image inline (base64) in the transcript. OpenClaw's
 * chat.history then finds the whole message over its 128 KB single-message
 * limit and replaces it with "[chat.history omitted: message too large]", so
 * after the reply the user's text and picture vanish from the chat. Before that
 * check runs, oversized user images are shrunk with OpenClaw's own image
 * sanitizer (cached per message); if shrinking is unavailable the image block is
 * dropped and the text is kept. Transcripts on disk are never changed. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

export const marker = '/* pinkie-history-image-thumbnails:v1 */';
const anchor = '\tconst normalized = historyPage.messages;\n';

export function helperSource(toolImagesFile, exportName) {
  return `${marker}
const pinkieHistoryThumbCache = new Map();
async function pinkieThumbnailOversizedImages(messages, maxSingleMessageBytes) {
\tif (!Array.isArray(messages) || !messages.length) return messages;
\tlet changed = false;
\tconst out = [];
\tfor (const message of messages) {
\t\tconst content = message && typeof message === "object" && String(message.role || "").toLowerCase() === "user" && Array.isArray(message.content) ? message.content : null;
\t\tif (!content || !content.some((block) => block?.type === "image" && typeof block.data === "string") || jsonUtf8Bytes(message) <= maxSingleMessageBytes) {
\t\t\tout.push(message);
\t\t\tcontinue;
\t\t}
\t\tconst key = String(message.__openclaw?.id || message.__openclaw?.idempotencyKey || message.timestamp || "") + ":" + content.reduce((sum, block) => sum + (typeof block?.data === "string" ? block.data.length : 0), 0);
\t\tlet slim = pinkieHistoryThumbCache.get(key);
\t\tif (!slim) {
\t\t\tlet blocks;
\t\t\ttry {
\t\t\t\tconst { ${exportName}: sanitize } = await import("./${toolImagesFile}");
\t\t\t\tblocks = await sanitize(content, "chat.history", { maxDimensionPx: 640, maxBytes: 80 * 1024 });
\t\t\t} catch {
\t\t\t\tblocks = content.filter((block) => block?.type !== "image");
\t\t\t}
\t\t\t// The sanitizer reports failures as text blocks; never show those to the user.
\t\t\tblocks = blocks.filter((block) => !(block?.type === "text" && /^\\[chat\\.history\\] omitted /.test(block.text || "")));
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
  const chat = names.filter((name) => fs.readFileSync(path.join(dist, name), 'utf8').includes('const CHAT_HISTORY_OVERSIZED_PLACEHOLDER'));
  if (chat.length !== 1) throw new Error('无法唯一确认 chat.history 模块');
  let toolImagesFile = '', exportName = '';
  for (const name of names.filter((value) => value.startsWith('tool-images-'))) {
    const match = /sanitizeContentBlocksImages as ([\w$]+)/.exec(fs.readFileSync(path.join(dist, name), 'utf8'));
    if (match) { toolImagesFile = name; exportName = match[1]; }
  }
  if (!toolImagesFile) throw new Error('无法找到 OpenClaw 图片缩放模块');
  const file = path.join(dist, chat[0]);
  const original = fs.readFileSync(file, 'utf8');
  const next = transform(original, toolImagesFile, exportName);
  if (next === original) return {changed: false};
  const backup = backupRoot || path.join(os.homedir(), 'Library/Application Support/SuperPinkie/backups', 'history-thumbnails-' + Date.now());
  fs.mkdirSync(backup, {recursive: true, mode: 0o700});
  fs.copyFileSync(file, path.join(backup, chat[0]));
  if (fs.readFileSync(file, 'utf8') !== original) throw new Error('chat.history 模块正在被更新，未覆盖');
  fs.writeFileSync(file, next);
  return {changed: true, backup, file: chat[0]};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.OPENCLAW_ROOT;
  if (!root) throw new Error('请设置 OPENCLAW_ROOT');
  console.log(JSON.stringify(apply(root, {backupRoot: process.env.PINKIE_PATCH_BACKUP_ROOT || undefined})));
}
