// A cut-down copy of OpenClaw's embedded-runner overflow loop. It carries every
// anchor apply-overflow-compaction-events.mjs edits, in the same order, so the
// patched source can actually be run.
export const importLine = 'import { S as withX, c as emitAgentEvent, d as getY } from "./agent-events-ABC.js"';
export const nativeRecoveryText = 'Context overflow: prompt too large for the model. Try /reset (or /new) to start a fresh session, or use a larger-context model.';

export const runner = [
  'function run(params, log$1, provider, modelId, ctxInfo, contextEngine, sendPrompt) {',
  'const MAX_OVERFLOW_COMPACTION_ATTEMPTS = 3;',
  'let overflowCompactionAttempts = 0;',
  'let toolResultTruncationAttempted = false;',
  'const attemptCompactionCount = params.attemptCompactionCount ?? 0;',
  'const isLikelyContextOverflowError = (text) => /context overflow|prompt too large|maximum context length/i.test(text);',
  'for (let turn = 0; turn < 10; turn++) {',
  'const promptError = params.assistantError ? null : sendPrompt(turn);',
  'const assistantErrorText = params.assistantError ? sendPrompt(turn) : null;',
  'if (!promptError && !assistantErrorText) return {ok: true, compactions: overflowCompactionAttempts};',
  'const contextOverflowError = (() => {',
  'if (promptError) {',
  'const errorText = String(promptError);',
  'if (isLikelyContextOverflowError(errorText)) return {',
  'text: errorText,',
  'source: "promptError"',
  '};',
  'return null;',
  '}',
  'if (assistantErrorText && isLikelyContextOverflowError(assistantErrorText)) return {',
  'text: assistantErrorText,',
  'source: "assistantError"',
  '};',
  'return null;',
  '})();',
  'if (!contextOverflowError) return {ok: false, text: String(promptError ?? assistantErrorText), compactions: overflowCompactionAttempts};',
  'const errorText = contextOverflowError.text;',
  'const overflowTokenCountForCompaction = ctxInfo.tokens + 1;',
  'const isCompactionFailure = false;',
  'const hadAttemptLevelCompaction = attemptCompactionCount > 0;',
  'if (!isCompactionFailure && hadAttemptLevelCompaction && overflowCompactionAttempts < MAX_OVERFLOW_COMPACTION_ATTEMPTS) {',
  'overflowCompactionAttempts++;',
  'continue;',
  '}',
  'if (!isCompactionFailure && !hadAttemptLevelCompaction && overflowCompactionAttempts < MAX_OVERFLOW_COMPACTION_ATTEMPTS) {',
  'overflowCompactionAttempts++;',
  'log$1.warn(`context overflow detected (attempt ${overflowCompactionAttempts}/${MAX_OVERFLOW_COMPACTION_ATTEMPTS}); attempting auto-compaction for ${provider}/${modelId}`);',
  'let compactResult;',
  'const overflowCompactionRuntimeSettings = {',
  'tokenBudget: ctxInfo.tokens,',
  'degradedReason: "context_overflow"',
  '};',
  'compactResult = contextEngine({',
  'tokenBudget: ctxInfo.tokens,',
  '...overflowTokenCountForCompaction !== void 0 ? { currentTokenCount: overflowTokenCountForCompaction } : {},',
  'runtimeSettings: overflowCompactionRuntimeSettings',
  '});',
  'if (compactResult.compacted) {',
  'log$1.info(`auto-compaction succeeded for ${provider}/${modelId}; retrying prompt`);',
  'continue;',
  '}',
  'log$1.warn(`auto-compaction failed for ${provider}/${modelId}: ${compactResult.reason ?? "nothing to compact"}`);',
  '}',
  'if (!toolResultTruncationAttempted) {',
  'toolResultTruncationAttempted = true;',
  'if (params.truncate?.()) continue;',
  '}',
  `const overflowRecoveryText = ${JSON.stringify(nativeRecoveryText)};`,
  'return {ok: false, text: overflowRecoveryText, compactions: overflowCompactionAttempts};',
  '}',
  '}',
].join('\n');

// What the v1 patch produced, rebuilt here so the v1 -> v2 upgrade is exercised.
export function v1(source = runner) {
  const emit = (data) => `try { if (params.sessionKey) pinkieEmitAgentEvent({ runId: params.runId, sessionKey: params.sessionKey, stream: "compaction", data: ${data} }); } catch {}`;
  const at = (anchor, data) => (text) => text.replace(anchor, `${anchor}\n${emit(data)}`);
  return [
    at('attempting auto-compaction for ${provider}/${modelId}`);', '{ phase: "start", reason: "overflow" }'),
    at('retrying prompt`);', '{ phase: "end", completed: true, willRetry: true, reason: "overflow" }'),
    at('"nothing to compact"}`);', '{ phase: "end", completed: false, willRetry: false, reason: "overflow" }'),
  ].reduce((text, edit) => edit(text), `/* pinkie-overflow-compaction-events:v1 */\nimport { c as pinkieEmitAgentEvent } from "./agent-events-ABC.js";\n${source}`);
}

export function load(source, emitter = () => {}) {
  const code = source.replace(/^\/\*.*\*\/\n/u, '').replace(/^import .*\n/gmu, '');
  return new Function('pinkieEmitAgentEvent', `${code}\nreturn run;`)(emitter);
}

export const log = {warn() {}, info() {}};

/** Run `source` against a prompt that fails with `errors[turn]` (null = success)
 *  and a context engine that records every compaction request. */
export function drive(source, errors, {compacted = true, emitter, ...params} = {}) {
  const compactions = [];
  let truncations = 0;
  const engine = (request) => { compactions.push(request); return {compacted, reason: compacted ? undefined : 'nothing'}; };
  const send = (turn) => errors[Math.min(turn, errors.length - 1)];
  const result = load(source, emitter)({truncate: () => { truncations++; return false; }, ...params},
    log, 'aws-quick', 'claude-x', {tokens: 128000}, engine, send);
  return {...result, requests: compactions, truncations};
}
