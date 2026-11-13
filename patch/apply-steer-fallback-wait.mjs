/**
 * 「立即追加」不再和正在跑的一轮抢写同一个会话文件。
 *
 * 运行中追加消息时，网关把这条用户消息的记录器交给正在跑的那一轮（steer），
 * 由那一轮在消化这条消息时、持着会话写锁把它写进 transcript。但 chat.send
 * 结束时看到「没有新起一轮」，会立刻走兜底 persistFallback() 再写一遍；这时
 * 那一轮往往正放开写锁在等模型或工具，回来核对文件指纹发现多了一条外来的
 * 用户消息，就判成 EmbeddedAttemptSessionTakeoverError，整轮失败
 * （「session file changed while embedded prompt lock was released」）。
 * 没撞上时也会留下一条重复的、没有后续的用户消息。
 *
 * 修法：steer 被接受后，给记录器挂上「等那一轮结束」的承诺
 * （markRuntimePersistencePending）。persistFallback 本来就会先等它：
 * 那一轮写进去了 → 兜底跳过；那一轮没写就结束了 → 兜底在没人持锁时补写，
 * 消息不会丢。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const marker = '/* pinkie-steer-fallback-wait:v1 */';
const anchor = `\t\tif (steerOutcome.queued) {\n\t\t\ttry {\n\t\t\t\tawait opts?.onTurnAdopted?.();`;
// 6 小时：长任务也够用；真超时了兜底照常补写，只是退回原来的行为。
const insertion = `\t\tif (steerOutcome.queued) {\n\t\t\t${marker}\n\t\t\tconst pinkieSteerRecorder = followupRun.userTurnTranscriptRecorder;\n\t\t\tif (pinkieSteerRecorder && !pinkieSteerRecorder.hasPersisted?.() && !pinkieSteerRecorder.hasRuntimePersistencePending?.() && typeof pinkieSteerRecorder.markRuntimePersistencePending === "function") {\n\t\t\t\tconst pinkieSteerRunKey = activeReplyOperation?.key ?? sessionKey;\n\t\t\t\tif (pinkieSteerRunKey) pinkieSteerRecorder.markRuntimePersistencePending(Promise.resolve(replyRunRegistry.waitForIdle(pinkieSteerRunKey, 6 * 60 * 60 * 1e3)).catch(() => void 0));\n\t\t\t}\n\t\t\ttry {\n\t\t\t\tawait opts?.onTurnAdopted?.();`;

export function transform(source) {
  if (source.includes(marker)) return source;
  if (source.split(anchor).length !== 2) throw new Error('OpenClaw steer branch structure changed');
  if (!/import \{[^}]*\breplyRunRegistry\b[^}]*\} from "\.\/run-state-[\w-]+\.js";/.test(source)) {
    throw new Error('OpenClaw runner no longer imports replyRunRegistry');
  }
  return source.replace(anchor, insertion);
}

export function apply(root, {backupRoot} = {}) {
  backupRoot = backupRoot || process.env.PINKIE_PATCH_BACKUP_ROOT || undefined;
  const dist = path.join(root, 'dist');
  const names = fs.readdirSync(dist).filter((name) => /^agent-runner\.runtime-.*\.(?:m?js)$/u.test(name))
    .filter((name) => {
      const source = fs.readFileSync(path.join(dist, name), 'utf8');
      return source.includes(marker) || source.includes('queueEmbeddedAgentMessageWithOutcomeAsync(steerSessionId');
    });
  if (names.length !== 1) throw new Error('OpenClaw runner bundle cannot be uniquely identified');
  const file = path.join(dist, names[0]);
  const original = fs.readFileSync(file, 'utf8');
  const next = transform(original);
  if (next === original) return {changed: false, file};
  const backup = backupRoot || path.join(os.homedir(), 'Library/Application Support/SuperPinkie/backups', `steer-fallback-${Date.now()}`);
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
