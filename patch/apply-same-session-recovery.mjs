/** Keep compaction failures on the current session instead of suggesting /new first. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const marker = '/* pinkie-same-session-recovery:v1 */';
const replacements = [
  [
    'return `⚠️ Context is too large and auto-compaction could not recover this turn.${options?.includeDetails && reason ? ` Reason: ${reason}.` : ""} Try again, use /compact, or use /new to start a fresh session.`;',
    'return `⚠️ 当前会话已保留。上下文压缩暂时未完成，系统会在当前会话内继续恢复；请稍后重试，通常不需要使用 /new。${options?.includeDetails && reason ? ` 原因：${reason}。` : ""}`;'
  ],
  [
    'const prefix = params.preserveSessionMapping ? "⚠️ Auto-compaction could not recover this turn. I kept this conversation mapped to the current session. Please try again, use /compact, or use /new to start a fresh session." : params.duringCompaction ? "⚠️ Context limit exceeded during compaction. I\'ve reset our conversation to start fresh - please try again." : "⚠️ Context limit exceeded. I\'ve reset our conversation to start fresh - please try again.";',
    'const prefix = params.preserveSessionMapping ? "⚠️ 当前会话已保留。上下文压缩暂时未完成，系统会在当前会话内继续恢复；请稍后重试，通常不需要使用 /new。" : params.duringCompaction ? "⚠️ 上下文压缩暂时未完成，当前会话仍已保留；请稍后在本会话重试。" : "⚠️ 上下文超过当前模型容量，当前会话仍已保留；系统将优先尝试在本会话内恢复。";'
  ]
];
export function transform(source) {
  if (source.includes(marker)) return source;
  if (source.includes('当前会话已保留。上下文压缩暂时未完成')) return marker + '\n' + source;
  let next = source;
  for (const [from, to] of replacements) {
    if (!next.includes(from)) throw new Error('OpenClaw recovery message structure changed');
    next = next.replace(from, to);
  }
  return marker + '\n' + next;
}
export function apply(root, {backupRoot} = {}) {
  const dist = path.join(root, 'dist');
  const names = fs.readdirSync(dist).filter((name) => name.startsWith('agent-runner.runtime-') && name.endsWith('.js'));
  if (names.length !== 1) throw new Error('OpenClaw runner bundle cannot be uniquely identified');
  const file = path.join(dist, names[0]);
  const original = fs.readFileSync(file, 'utf8');
  const next = transform(original);
  if (next === original) return {changed: false, file};
  const backup = backupRoot || path.join(os.homedir(), 'Library/Application Support/SuperPinkie/backups', `same-session-${Date.now()}`);
  fs.mkdirSync(backup, {recursive: true, mode: 0o700});
  fs.copyFileSync(file, path.join(backup, path.basename(file)));
  if (fs.readFileSync(file, 'utf8') !== original) throw new Error('OpenClaw runner bundle changed during patch');
  fs.writeFileSync(file, next);
  return {changed: true, file, backup};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.OPENCLAW_ROOT;
  if (!root) throw new Error('Set OPENCLAW_ROOT to the active OpenClaw package');
  console.log(JSON.stringify(apply(root)));
}
