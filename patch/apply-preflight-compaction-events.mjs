/** Tell the chat page when a pre-send (preflight) compaction starts and ends.
 *
 * OpenClaw only emits `agent` events with `stream: "compaction"` for the rare
 * mid-run overflow compaction. The common path — the context is over budget
 * before a message is sent — calls `runPreflightCompactionIfNeeded`, which only
 * delivers an optional chat-text notice (off by default). The Control UI never
 * heard about it, so the compaction divider/animation never appeared and the
 * history looked like it was "suddenly" compacted.
 *
 * This adds a session-scoped agent event beside that notice. The gateway
 * broadcasts agent events carrying `sessionKey` to the Control UI even without
 * a registered run, and laolao-context-compact.js already animates them. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const marker = '/* pinkie-preflight-compaction-events:v1 */';
const anchor = '\tconst notifyCompaction = async (phase) => {\n\t\ttry {\n\t\t\tawait params.onCompactionNotice?.(phase);';
const replacement = '\tconst pinkiePreflightCompactionRunId = `pinkie-preflight-compaction:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;\n'
  + '\tconst notifyCompaction = async (phase) => {\n'
  + '\t\ttry {\n'
  + '\t\t\tif (params.sessionKey) emitAgentEvent({\n'
  + '\t\t\t\trunId: pinkiePreflightCompactionRunId,\n'
  + '\t\t\t\tsessionKey: params.sessionKey,\n'
  + '\t\t\t\tstream: "compaction",\n'
  + '\t\t\t\tdata: phase === "start" ? { phase: "start", preflight: true } : { phase: "end", completed: phase === "end", ...phase === "skipped" ? { skipped: true } : {}, preflight: true }\n'
  + '\t\t\t});\n'
  + '\t\t} catch (err) {\n'
  + '\t\t\tlogVerbose(`preflightCompaction event failed: ${String(err)}`);\n'
  + '\t\t}\n'
  + '\t\ttry {\n'
  + '\t\t\tawait params.onCompactionNotice?.(phase);';

export function transform(source) {
  if (source.includes(marker)) return source;
  if (source.split(anchor).length !== 2) throw new Error('OpenClaw preflight compaction structure changed: notifyCompaction anchor');
  if (!/\bemitAgentEvent\b/u.test(source.slice(0, 4000))) throw new Error('OpenClaw runner bundle no longer imports emitAgentEvent');
  if (!source.includes('function logVerbose') && !/\blogVerbose\b/u.test(source.slice(0, 4000))) throw new Error('OpenClaw runner bundle no longer has logVerbose');
  return marker + '\n' + source.replace(anchor, replacement);
}

export function apply(root, {backupRoot} = {}) {
  backupRoot = backupRoot || process.env.PINKIE_PATCH_BACKUP_ROOT || undefined;
  const dist = path.join(root, 'dist');
  const names = fs.readdirSync(dist).filter((name) => /^agent-runner\.runtime-.*\.(?:m?js)$/u.test(name))
    .filter((name) => {
      const source = fs.readFileSync(path.join(dist, name), 'utf8');
      return source.includes(marker) || source.includes(anchor);
    });
  if (names.length !== 1) throw new Error('OpenClaw runner bundle cannot be uniquely identified');
  const file = path.join(dist, names[0]);
  const original = fs.readFileSync(file, 'utf8');
  const next = transform(original);
  if (next === original) return {changed: false, file};
  const backup = backupRoot || path.join(os.homedir(), 'Library/Application Support/SuperPinkie/backups', `preflight-compaction-${Date.now()}`);
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
