/** Tell the chat page when a mid-run (overflow / mid-turn precheck) compaction starts and ends.
 *
 * With `compaction.mode: "safeguard"` OpenClaw owns compaction, so the agent
 * runtime's own auto-compaction (which emits `stream: "compaction"` agent events)
 * is switched off. A long task that fills the context is caught between tool
 * calls by the mid-turn precheck; the embedded runner then compacts through the
 * context engine and continues from the current transcript. That path only
 * writes log lines: the Control UI never hears a start or an end, so the
 * compaction animation never plays and the run looks like it suddenly stopped
 * (11-16 user report: 「自动压缩上下文以后继续工作从来没有出现过」).
 *
 * This adds session-scoped agent events at the three log lines of that path:
 * start, success (willRetry: the run goes on) and failure. The gateway broadcasts
 * agent events carrying `sessionKey` to the Control UI, and
 * laolao-context-compact.js turns them into the notice + "continuing" state.
 * Pairs with apply-preflight-compaction-events.mjs (the pre-send path). */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const marker = '/* pinkie-overflow-compaction-events:v1 */';
const startAnchor = 'log$1.warn(`context overflow detected (attempt ${overflowCompactionAttempts}/${MAX_OVERFLOW_COMPACTION_ATTEMPTS}); attempting auto-compaction for ${provider}/${modelId}`);';
const doneAnchor = 'log$1.info(`auto-compaction succeeded for ${provider}/${modelId}; retrying prompt`);';
const failAnchor = 'log$1.warn(`auto-compaction failed for ${provider}/${modelId}: ${compactResult.reason ?? "nothing to compact"}`);';
const emit = (data) => `try { if (params.sessionKey) pinkieEmitAgentEvent({ runId: params.runId, sessionKey: params.sessionKey, stream: "compaction", data: ${data} }); } catch {}`;

/** `importLine` is the runner's own import of emitAgentEvent, e.g.
 *  `import { c as emitAgentEvent } from "./agent-events-XXXX.js"`. */
export function transform(source, importLine) {
  if (source.includes(marker)) return source;
  for (const [name, anchor] of [['start', startAnchor], ['success', doneAnchor], ['failure', failAnchor]]) {
    if (source.split(anchor).length !== 2) throw new Error(`OpenClaw overflow compaction structure changed: ${name} anchor`);
  }
  const match = /import \{[^}]*\b(\w+) as emitAgentEvent\b[^}]*\} from ("[^"]+")/u.exec(importLine || '');
  if (!match) throw new Error('OpenClaw emitAgentEvent import not found');
  const header = `${marker}\nimport { ${match[1]} as pinkieEmitAgentEvent } from ${match[2]};\n`;
  return header + source
    .replace(startAnchor, `${startAnchor}\n${emit('{ phase: "start", reason: "overflow" }')}`)
    .replace(doneAnchor, `${doneAnchor}\n${emit('{ phase: "end", completed: true, willRetry: true, reason: "overflow" }')}`)
    .replace(failAnchor, `${failAnchor}\n${emit('{ phase: "end", completed: false, willRetry: false, reason: "overflow" }')}`);
}

export function apply(root, {backupRoot} = {}) {
  backupRoot = backupRoot || process.env.PINKIE_PATCH_BACKUP_ROOT || undefined;
  const dist = path.join(root, 'dist');
  const read = (name) => fs.readFileSync(path.join(dist, name), 'utf8');
  const names = fs.readdirSync(dist).filter((name) => /^embedded-agent-.*\.(?:m?js)$/u.test(name))
    .filter((name) => { const source = read(name); return source.includes(marker) || source.includes(startAnchor); });
  if (names.length !== 1) throw new Error('OpenClaw embedded runner bundle cannot be uniquely identified');
  // Take the exact import (file + export alias) the agent runner already uses.
  const runners = fs.readdirSync(dist).filter((name) => /^agent-runner\.runtime-.*\.(?:m?js)$/u.test(name));
  const importLine = runners.map((name) => /import \{[^}]*\bas emitAgentEvent\b[^}]*\} from "[^"]+"/u.exec(read(name))?.[0]).find(Boolean);
  const file = path.join(dist, names[0]);
  const original = fs.readFileSync(file, 'utf8');
  const next = transform(original, importLine);
  if (next === original) return {changed: false, file};
  const backup = backupRoot || path.join(os.homedir(), 'Library/Application Support/SuperPinkie/backups', `overflow-compaction-${Date.now()}`);
  fs.mkdirSync(backup, {recursive: true, mode: 0o700});
  fs.copyFileSync(file, path.join(backup, path.basename(file)));
  if (fs.readFileSync(file, 'utf8') !== original) throw new Error('OpenClaw embedded runner bundle changed during patch');
  fs.writeFileSync(file, next);
  return {changed: true, file, backup};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.OPENCLAW_ROOT;
  if (!root) throw new Error('Set OPENCLAW_ROOT to the active OpenClaw package');
  console.log(JSON.stringify(apply(root)));
}
