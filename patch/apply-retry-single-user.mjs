/**
 * 模型失败自动重试后，用户那句话不再写两遍。
 *
 * OpenClaw 遇到「还没回复就失败」的上游错误（503 等）会自己再试一次
 * （agent-runner：Transient HTTP provider error before reply … Retrying once）。
 * 重试是新开一次 attempt：上一次已经把用户消息和一条空的失败回复写进了会话，
 * 这一次又把同一条用户消息（同一个 idempotencyKey）接在失败回复后面写一遍。
 * 结果界面上是「你好 — 分割线 — 你好」，模型那边也收到两条一样的用户消息。
 *
 * 修法：每次 attempt 开始、写用户消息之前，看当前叶子：
 *   叶子 = 一条没产出任何内容的失败回复（stopReason=error，正文为空或只有
 *          OpenClaw 自己的占位句），而且
 *   它的上一条 = 用户消息，idempotencyKey 和这次要写的完全一样（同一次发送）
 * 就把会话叶子退回到那条用户消息之前（branch，和 OpenClaw 自己修「孤儿用户
 * 消息」是同一个办法；旧记录留在文件里，只是不在当前分支上）。重试写下的
 * 用户消息就成了唯一的一条；聊天记录读的是当前分支，所以界面只显示一遍。
 *
 * 不碰的情况：
 *   - 这次 attempt 不写用户消息（suppressNextUserMessagePersistence）——退回去
 *     用户那句就丢了。
 *   - 失败回复里有任何正文、工具调用：那是真做过事的一轮，保留。
 *   - idempotencyKey 不同：用户自己又发了一遍，是两次发送，照原样。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const marker = '/* pinkie-retry-single-user:v1 */';
const anchor = '\t\t\t\tconst leafEntry = isRawModelRun ? null : sessionManager.getLeafEntry();\n';
const requiredScope = 'const preparedUserTurnMessage = await params.userTurnTranscriptRecorder?.resolveMessage();';
const FALLBACK_TEXT = '[assistant turn failed before producing content]';

const block = `\t\t\t\t${marker}
\t\t\t\tif (!isRawModelRun && params.suppressNextUserMessagePersistence !== true) try {
\t\t\t\t\tconst pinkieRetryKey = typeof preparedUserTurnMessage?.idempotencyKey === "string" ? preparedUserTurnMessage.idempotencyKey : "";
\t\t\t\t\tconst pinkieFailedLeaf = pinkieRetryKey ? sessionManager.getLeafEntry() : void 0;
\t\t\t\t\tconst pinkieFailed = pinkieFailedLeaf?.type === "message" ? pinkieFailedLeaf.message : void 0;
\t\t\t\t\tconst pinkieFailedParts = Array.isArray(pinkieFailed?.content) ? pinkieFailed.content : typeof pinkieFailed?.content === "string" ? [{ type: "text", text: pinkieFailed.content }] : [];
\t\t\t\t\tconst pinkieFailedEmpty = pinkieFailed?.role === "assistant" && pinkieFailed.stopReason === "error" && pinkieFailedParts.every((part) => part && ((part.type === "text" && (!String(part.text || "").trim() || part.text === ${JSON.stringify(FALLBACK_TEXT)})) || (part.type === "thinking" && !String(part.thinking || "").trim())));
\t\t\t\t\tconst pinkieFailedUser = pinkieFailedEmpty && pinkieFailedLeaf.parentId ? sessionManager.getEntry(pinkieFailedLeaf.parentId) : void 0;
\t\t\t\t\tif (pinkieFailedUser?.type === "message" && pinkieFailedUser.message?.role === "user" && pinkieFailedUser.message.idempotencyKey === pinkieRetryKey) {
\t\t\t\t\t\tif (pinkieFailedUser.parentId) sessionManager.branch(pinkieFailedUser.parentId);
\t\t\t\t\t\telse sessionManager.resetLeaf();
\t\t\t\t\t\tactiveSession.agent.state.messages = sessionManager.buildSessionContext().messages;
\t\t\t\t\t\tlog$2.warn(\`pinkie: retry of the same send replaces its failed attempt (no duplicate user turn) runId=\${params.runId} sessionId=\${params.sessionId}\`);
\t\t\t\t\t}
\t\t\t\t} catch (pinkieRetryError) {
\t\t\t\t\tlog$2.warn(\`pinkie: failed-attempt cleanup skipped: \${String(pinkieRetryError?.message || pinkieRetryError)}\`);
\t\t\t\t}
`;

export function transform(source) {
  if (source.includes(marker)) return source;
  if (source.split(anchor).length !== 2) throw new Error('OpenClaw attempt leaf repair structure changed');
  if (source.split(requiredScope).length !== 2) throw new Error('OpenClaw attempt no longer resolves the prepared user turn');
  if (source.indexOf(requiredScope) > source.indexOf(anchor)) throw new Error('prepared user turn is resolved after the leaf repair');
  if (!/\blog\$2\.warn\(/.test(source)) throw new Error('OpenClaw attempt logger changed');
  return source.replace(anchor, block + anchor);
}

export function apply(root, {backupRoot} = {}) {
  backupRoot = backupRoot || process.env.PINKIE_PATCH_BACKUP_ROOT || undefined;
  const dist = path.join(root, 'dist');
  const names = fs.readdirSync(dist).filter((name) => /^selection-.*\.(?:m?js)$/u.test(name))
    .filter((name) => {
      const source = fs.readFileSync(path.join(dist, name), 'utf8');
      return source.includes(marker) || source.includes(anchor);
    });
  if (names.length !== 1) throw new Error('OpenClaw attempt bundle cannot be uniquely identified');
  const file = path.join(dist, names[0]);
  const original = fs.readFileSync(file, 'utf8');
  const next = transform(original);
  if (next === original) return {changed: false, file};
  const backup = backupRoot || path.join(os.homedir(), 'Library/Application Support/SuperPinkie/backups', `retry-single-user-${Date.now()}`);
  fs.mkdirSync(backup, {recursive: true, mode: 0o700});
  fs.copyFileSync(file, path.join(backup, path.basename(file)));
  if (fs.readFileSync(file, 'utf8') !== original) throw new Error('OpenClaw attempt bundle changed during patch');
  fs.writeFileSync(file, next);
  return {changed: true, file, backup};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.OPENCLAW_ROOT;
  if (!root) throw new Error('Set OPENCLAW_ROOT to the active OpenClaw package');
  console.log(JSON.stringify(apply(root)));
}
