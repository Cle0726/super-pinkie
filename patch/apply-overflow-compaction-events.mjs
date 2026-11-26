/** Tell the chat page when a mid-run (overflow / mid-turn precheck) compaction starts and ends,
 *  and stop the overflow loop early when the request is over a gateway's single-frame limit.
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
 * v1 adds session-scoped agent events at the three log lines of that path:
 * start, success (willRetry: the run goes on) and failure. The gateway broadcasts
 * agent events carrying `sessionKey` to the Control UI, and
 * laolao-context-compact.js turns them into the notice + "continuing" state.
 * Pairs with apply-preflight-compaction-events.mjs (the pre-send path).
 *
 * v2: the aws-quick gateway takes at most ~63000 bytes per request and answers
 * "64 KB message limit ... bytes after shortening, over N" otherwise. That is a
 * frame limit, not the model window. Only that gateway wording counts: a bare
 * `context_length_exceeded` is also what OpenAI-compatible providers send for a
 * real model-window overflow, which keeps the native loop. Compacting to the
 * model window (or retrying without compacting) cannot fit it, so the native
 * loop compacted up to 3 times and the user saw 「整理上下文」 again and again.
 * A frame-limit error now compacts once, straight to PINKIE_FRAME_TOKEN_BUDGET;
 * if the next request is still over the limit the run stops with a plain
 * message instead of looping. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const marker = '/* pinkie-overflow-compaction-events:v2 */';
const v1Marker = '/* pinkie-overflow-compaction-events:v1 */';
const startAnchor = 'log$1.warn(`context overflow detected (attempt ${overflowCompactionAttempts}/${MAX_OVERFLOW_COMPACTION_ATTEMPTS}); attempting auto-compaction for ${provider}/${modelId}`);';
const doneAnchor = 'log$1.info(`auto-compaction succeeded for ${provider}/${modelId}; retrying prompt`);';
const failAnchor = 'log$1.warn(`auto-compaction failed for ${provider}/${modelId}: ${compactResult.reason ?? "nothing to compact"}`);';
const emit = (data) => `try { if (params.sessionKey) pinkieEmitAgentEvent({ runId: params.runId, sessionKey: params.sessionKey, stream: "compaction", data: ${data} }); } catch {}`;

export const FRAME_TOKEN_BUDGET = 12000;
export const FRAME_LIMIT_TEXT = '这条对话一帧装不下（模型服务单条消息上限约 63KB），已停下，请开新对话或分段发送。';
const frameHeader = [
  'const PINKIE_FRAME_LIMIT = /64 ?KB message limit|bytes after shortening, over \\d+/i;',
  `const PINKIE_FRAME_TOKEN_BUDGET = ${FRAME_TOKEN_BUDGET};`,
].join('\n');
const frameBudget = 'tokenBudget: pinkieFrameLimit ? Math.min(ctxInfo.tokens, PINKIE_FRAME_TOKEN_BUDGET) : ctxInfo.tokens,';
const nativeRecoveryText = 'const overflowRecoveryText = "Context overflow: prompt too large for the model. Try /reset (or /new) to start a fresh session, or use a larger-context model.";';
// [name, anchor (string or RegExp), replacement]
const frameEdits = [
  ['prompt overflow test', 'if (isLikelyContextOverflowError(errorText)) return {',
    'if (isLikelyContextOverflowError(errorText) || PINKIE_FRAME_LIMIT.test(errorText)) return {'],
  ['assistant overflow test', 'if (assistantErrorText && isLikelyContextOverflowError(assistantErrorText)) return {',
    'if (assistantErrorText && (isLikelyContextOverflowError(assistantErrorText) || PINKIE_FRAME_LIMIT.test(assistantErrorText))) return {'],
  ['overflow error text', 'const errorText = contextOverflowError.text;',
    'const errorText = contextOverflowError.text;\nconst pinkieFrameLimit = PINKIE_FRAME_LIMIT.test(errorText);'],
  ['attempt-level compaction', 'const hadAttemptLevelCompaction = attemptCompactionCount > 0;',
    'const hadAttemptLevelCompaction = attemptCompactionCount > 0;\nconst pinkieFrameStop = pinkieFrameLimit && overflowCompactionAttempts >= 1;\nif (pinkieFrameStop) log$1.warn(`[pinkie-frame-limit] request still over the gateway frame limit after ${overflowCompactionAttempts} compaction(s) for ${provider}/${modelId}; stopping`);'],
  ['retry without compaction', 'if (!isCompactionFailure && hadAttemptLevelCompaction && overflowCompactionAttempts < MAX_OVERFLOW_COMPACTION_ATTEMPTS) {',
    'if (!pinkieFrameLimit && !isCompactionFailure && hadAttemptLevelCompaction && overflowCompactionAttempts < MAX_OVERFLOW_COMPACTION_ATTEMPTS) {'],
  ['compaction branch', 'if (!isCompactionFailure && !hadAttemptLevelCompaction && overflowCompactionAttempts < MAX_OVERFLOW_COMPACTION_ATTEMPTS) {',
    'if (!pinkieFrameStop && !isCompactionFailure && (!hadAttemptLevelCompaction || pinkieFrameLimit) && overflowCompactionAttempts < MAX_OVERFLOW_COMPACTION_ATTEMPTS) {'],
  ['runtime settings budget', /tokenBudget: ctxInfo\.tokens,(\s*degradedReason: "context_overflow")/gu, `${frameBudget}$1`],
  ['compaction budget', /tokenBudget: ctxInfo\.tokens,(\s*\.\.\.overflowTokenCountForCompaction !== void 0)/gu, `${frameBudget}$1`],
  ['tool result truncation', 'if (!toolResultTruncationAttempted) {', 'if (!pinkieFrameStop && !toolResultTruncationAttempted) {'],
  ['give-up text', nativeRecoveryText,
    nativeRecoveryText.replace('= "', `= pinkieFrameLimit ? ${JSON.stringify(FRAME_LIMIT_TEXT)} : "`)],
];

const count = (source, anchor) => typeof anchor === 'string'
  ? source.split(anchor).length - 1 : [...source.matchAll(anchor)].length;

/** `importLine` is the runner's own import of emitAgentEvent, e.g.
 *  `import { c as emitAgentEvent } from "./agent-events-XXXX.js"`.
 *  Accepts the unpatched bundle or one already carrying v1. */
export function transform(source, importLine) {
  if (source.includes(marker)) return source;
  const upgrading = source.startsWith(`${v1Marker}\n`);
  for (const [name, anchor] of [['start', startAnchor], ['success', doneAnchor], ['failure', failAnchor], ...frameEdits]) {
    if (count(source, anchor) !== 1) throw new Error(`OpenClaw overflow compaction structure changed: ${name} anchor`);
  }
  let body;
  let header;
  if (upgrading) {
    // v1 already imported the emitter and placed the three events; keep them.
    const rest = source.slice(v1Marker.length + 1);
    const end = rest.indexOf('\n') + 1;
    const v1Import = rest.slice(0, end);
    if (!/^import \{ \w+ as pinkieEmitAgentEvent \} from "[^"]+";\n$/u.test(v1Import)) throw new Error('OpenClaw overflow compaction v1 header not recognized');
    header = `${marker}\n${v1Import}${frameHeader}\n`;
    body = rest.slice(end);
  } else {
    const match = /import \{[^}]*\b(\w+) as emitAgentEvent\b[^}]*\} from ("[^"]+")/u.exec(importLine || '');
    if (!match) throw new Error('OpenClaw emitAgentEvent import not found');
    header = `${marker}\nimport { ${match[1]} as pinkieEmitAgentEvent } from ${match[2]};\n${frameHeader}\n`;
    body = source
      .replace(startAnchor, `${startAnchor}\n${emit('{ phase: "start", reason: "overflow" }')}`)
      .replace(doneAnchor, `${doneAnchor}\n${emit('{ phase: "end", completed: true, willRetry: true, reason: "overflow" }')}`)
      .replace(failAnchor, `${failAnchor}\n${emit('{ phase: "end", completed: false, willRetry: false, reason: "overflow" }')}`);
  }
  for (const [, anchor, replacement] of frameEdits) {
    body = typeof anchor === 'string' ? body.replace(anchor, () => replacement) : body.replace(anchor, replacement);
  }
  return header + body;
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
