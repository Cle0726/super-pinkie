import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apply,transform} from '../patch/apply-compaction-boundary-recovery.mjs';
import {apply as applySameSession, transform as transformSameSession} from '../patch/apply-same-session-recovery.mjs';

const fixture=`function sessionBranchEntryToMessage(entry) { return entry.message; }
function collectSessionBranchMessages(sessionManager) {
\tconst getBranch = sessionManager?.getBranch;
\tif (typeof getBranch !== "function") return [];
\tlet entries;
\ttry {
\t\tentries = getBranch.call(sessionManager);
\t} catch {
\t\treturn [];
\t}
\tif (!Array.isArray(entries)) return [];
\treturn entries.map((entry) => entry && typeof entry === "object" ? sessionBranchEntryToMessage(entry) : void 0).filter((message) => Boolean(message));
}
function compactionSafeguardExtension(api) {
\tapi.on("session_before_compact", async (event, ctx) => {
\t\tconst { preparation, customInstructions: eventInstructions, signal } = event;
\t\tconst rawTurnPrefixMessages = preparation.turnPrefixMessages ?? [];
\t\tlet baseMessagesToSummarize = stripRuntimeContextCustomMessages(preparation.messagesToSummarize);
\t\tlet baseTurnPrefixMessages = stripRuntimeContextCustomMessages(rawTurnPrefixMessages);
\t\tlet hasRealSummarizable = containsRealConversation(baseMessagesToSummarize);
\t\tlet hasRealTurnPrefix = containsRealConversation(baseTurnPrefixMessages);
\t\tif (!hasRealSummarizable && !hasRealTurnPrefix) {
\t\t\tconst branchMessages = stripRuntimeContextCustomMessages(collectSessionBranchMessages(ctx.sessionManager));
\t\t\tif (containsRealConversation(branchMessages)) {
\t\t\t\tlog.info("Compaction safeguard: using session branch messages after compaction preparation omitted real conversation content.");
\t\t\t\tbaseMessagesToSummarize = branchMessages;
\t\t\t\tbaseTurnPrefixMessages = [];
\t\t\t\thasRealSummarizable = true;
\t\t\t\thasRealTurnPrefix = false;
\t\t\t}
\t\t}
\t\tif (!hasRealSummarizable) return {compaction:{firstKeptEntryId: preparation.firstKeptEntryId,}};
\t\tconst runtime = getCompactionSafeguardRuntime(ctx.sessionManager);
\t\tconst customInstructions = resolveCompactionInstructions(eventInstructions, runtime?.customInstructions);
\t\tconst recentTurnsPreserve = resolveRecentTurnsPreserve(runtime?.recentTurnsPreserve);
\t\tconst { preservedMessages: providerPreservedMessages } = splitPreservedRecentTurns({messages:baseMessagesToSummarize,recentTurnsPreserve});
\t\tif(providerPreservedMessages)return {compaction:{firstKeptEntryId: preparation.firstKeptEntryId,}};
\t\treturn {compaction:{firstKeptEntryId: preparation.firstKeptEntryId,}};
\t});
}`;

test('repairs empty preparation with a recent-turn boundary and is idempotent',()=>{
  const output=transform(fixture);
  assert.match(output,/resolveRecoveryFirstKeptEntryId/);
  assert.match(output,/maxTailChars/);
  assert.match(output,/effectiveFirstKeptEntryId = resolveRecoveryFirstKeptEntryId/);
  assert.equal((output.match(/firstKeptEntryId: effectiveFirstKeptEntryId,/g)||[]).length,3);
  assert.equal(transform(output),output);
});

test('same-session recovery messaging keeps /new as last-resort only',()=>{
  const source='return `⚠️ Context is too large and auto-compaction could not recover this turn.${options?.includeDetails && reason ? ` Reason: ${reason}.` : ""} Try again, use /compact, or use /new to start a fresh session.`;\nconst prefix = params.preserveSessionMapping ? "⚠️ Auto-compaction could not recover this turn. I kept this conversation mapped to the current session. Please try again, use /compact, or use /new to start a fresh session." : params.duringCompaction ? "⚠️ Context limit exceeded during compaction. I\'ve reset our conversation to start fresh - please try again." : "⚠️ Context limit exceeded. I\'ve reset our conversation to start fresh - please try again.";';
  const output=transformSameSession(source);
  assert.match(output,/当前会话已保留/);
  assert.match(output,/通常不需要使用 \/new/);
  assert.doesNotMatch(output,/Try again, use \/compact/);
});

test('fallback boundary obeys context pressure even when many recent turns were requested',()=>{
  const output=transform(fixture);
  const resolveBoundary=Function(`${output.replace(/^\/\* pinkie-compaction-boundary-recovery:v2 \*\/\n/,'')}\nreturn resolveRecoveryFirstKeptEntryId;`)();
  const entries=[];
  for(let turn=1;turn<=9;turn++){
    entries.push({type:'message',id:`u${turn}`,message:{role:'user',content:[{type:'text',text:`ask ${turn}`}]}});
    entries.push({type:'message',id:`a${turn}`,message:{role:'assistant',content:[{type:'text',text:'working'}]}});
    entries.push({type:'message',id:`t${turn}`,message:{role:'toolResult',content:[{type:'text',text:'x'.repeat(180000)}]}});
  }
  const sessionManager={getBranch:()=>entries};
  // The 1M model gets a conservative 500k-character raw suffix. The newest
  // two heavy turns fit; retaining all nine would immediately overflow again.
  assert.equal(resolveBoundary(sessionManager,'fallback',{
    recentTurnsPreserve:12,
    contextWindowTokens:1000000,
    keepRecentTokens:600000,
  }),'u8');
});

test('apply backs up and patches exactly one safeguard bundle',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'clekk-compaction-boundary-'));
  try{
    const dist=path.join(root,'dist');fs.mkdirSync(dist);
    const file=path.join(dist,'attempt.model-diagnostic-events-test.js');fs.writeFileSync(file,fixture);
    const backup=path.join(root,'backup');
    assert.equal(apply(root,{backupRoot:backup}).changed,true);
    assert.equal(fs.readFileSync(path.join(backup,path.basename(file)),'utf8'),fixture);
    assert.equal(apply(root,{backupRoot:backup}).changed,false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

// OpenClaw 2026.10 shape (dist/builtin-openclaw-*.mjs): the recovery path
// summarizes the boundary-scoped preparation range, and both the empty and
// the summarized results keep preparation.firstKeptEntryId.
const current2026=`function compactionSafeguardExtension(api) {
\tapi.on("session_before_compact", async (event, ctx) => {
\t\tconst { preparation, customInstructions: eventInstructions, signal, thinkingLevel, streamFn } = event;
\t\tconst previousSummary = normalizeLegacySplitTurnSummary(preparation.previousSummary?.trim());
\t\tlet baseMessagesToSummarize = stripRuntimeContextCustomMessages(preparation.messagesToSummarize);
\t\tlet baseTurnPrefixMessages = stripRuntimeContextCustomMessages(preparation.turnPrefixMessages ?? []);
\t\tconst latestUnresolvedUserRequest = preparation.latestUnresolvedUserRequest ?? null;
\t\tif (!containsRealConversation([...baseMessagesToSummarize, ...baseTurnPrefixMessages])) {
\t\t\tconst rangeMessages = stripRuntimeContextCustomMessages(collectPreparationRangeMessages(ctx.sessionManager, preparation.firstKeptEntryId));
\t\t\tif (containsRealConversation(rangeMessages)) {
\t\t\t\tlog.info("Compaction safeguard: summarizing the boundary-scoped preparation range after compaction preparation omitted real conversation content.");
\t\t\t\tbaseMessagesToSummarize = rangeMessages;
\t\t\t\tbaseTurnPrefixMessages = [];
\t\t\t}
\t\t}
\t\tconst hasRealConversation = containsRealConversation([...baseMessagesToSummarize, ...baseTurnPrefixMessages]) || containsRealConversation(stripRuntimeContextCustomMessages(collectSessionContextMessages(ctx.sessionManager)));
\t\tsetCompactionSafeguardCancellation(ctx.sessionManager, void 0);
\t\tconst cancelCompaction = (reason, error) => {
\t\t\tsetCompactionSafeguardCancellation(ctx.sessionManager, reason, error);
\t\t\treturn { cancel: true };
\t\t};
\t\tif (!hasRealConversation) {
\t\t\tlog.info("Compaction safeguard: no real conversation messages to summarize; writing compaction boundary to suppress re-trigger loop.");
\t\t\treturn { compaction: {
\t\t\t\tsummary: buildStructuredFallbackSummary(previousSummary),
\t\t\t\tfirstKeptEntryId: preparation.firstKeptEntryId,
\t\t\t\ttokensBefore: preparation.tokensBefore
\t\t\t} };
\t\t}
\t\tconst runtime = getCompactionSafeguardRuntime(ctx.sessionManager);
\t\tconst customInstructions = resolveCompactionInstructions(eventInstructions, runtime?.customInstructions);
\t\tconst turnPrefixMessages = baseTurnPrefixMessages;
\t\tconst recentTurnsPreserve = resolveRecentTurnsPreserve(runtime?.recentTurnsPreserve);
\t\tconst compactionResult = (summary) => ({ compaction: {
\t\t\tsummary,
\t\t\tfirstKeptEntryId: preparation.firstKeptEntryId,
\t\t\ttokensBefore: preparation.tokensBefore,
\t\t\tdetails: { readFiles: [], modifiedFiles: [] }
\t\t} });
\t\treturn compactionResult("done");
\t});
}`;

test('2026.10 safeguard recovery moves the stale boundary onto the recent-turn tail',()=>{
  const output=transform(current2026);
  assert.notEqual(output,current2026);
  assert.match(output,/pinkie-compaction-boundary-recovery:v3/);
  assert.match(output,/const pinkieRecoveryBoundary = \(\) => resolveRecoveryFirstKeptEntryId\(/);
  assert.match(output,/const pinkieResultBoundary = resolveRecoveryFirstKeptEntryId\(ctx\.sessionManager, preparation\.firstKeptEntryId, \{ recentTurnsPreserve,/);
  assert.match(output,/firstKeptEntryId: pinkieFirstKeptEntryId,/);
  assert.match(output,/firstKeptEntryId: pinkieResultBoundary,/);
  assert.doesNotMatch(output,/firstKeptEntryId: preparation\.firstKeptEntryId,/,'every returned boundary uses the recovered id');
  assert.equal(transform(output),output,'idempotent');
  assert.match(output,/function resolveRecoveryFirstKeptEntryId\(sessionManager, fallbackId, options = \{\}\)/);
  assert.match(output,/maxTailChars/);
});

// OpenClaw 2026.10 recovery copy (agent-runner.runtime-*.mjs): one helper
// string, no `${options?.includeDetails…}` template any more.
const currentRecovery='function buildContextOverflowRecoveryText(params) {\n'
  + '\treturn "⚠️ Auto-compaction could not recover this turn. I kept this conversation mapped to the current session. Please try again, use /compact, or use /new to start a fresh session." + ((!params.runtimeProvider || !params.runtimeModel || params.runtimeProvider === params.activeSessionEntry?.modelProvider && params.runtimeModel === params.activeSessionEntry?.model ? resolveHeartbeatBleedHint(params) : void 0) ?? "\\n\\nTry starting a fresh session or using a model with a larger context window.");\n'
  + '}\n';

test('2026.10 recovery copy keeps the session and /new as last resort only',()=>{
  const output=transformSameSession(currentRecovery);
  assert.notEqual(output,currentRecovery);
  assert.match(output,/pinkie-same-session-recovery:v2/);
  assert.match(output,/⚠️ 当前会话已保留。上下文压缩暂时未完成/);
  assert.match(output,/通常不需要使用 \/new。/);
  assert.doesNotMatch(output,/Auto-compaction could not recover this turn/);
  assert.match(output,/resolveHeartbeatBleedHint\(params\)/,'the extra hint suffix is preserved');
  assert.equal(transformSameSession(output),output,'idempotent');
});

test('apply() patches the 2026.10 runtime bundle in a throwaway root',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-same-session-'));
  try{
    const dist=path.join(root,'dist');fs.mkdirSync(dist);
    const file=path.join(dist,'agent-runner.runtime-TEST.mjs');
    fs.writeFileSync(file,currentRecovery);
    fs.writeFileSync(path.join(dist,'agent-runner.runtime.js'),'export * from "./agent-runner.runtime-TEST.mjs";\n');
    const result=applySameSession(root,{backupRoot:path.join(root,'backup')});
    assert.equal(result.changed,true);
    assert.equal(result.file,file);
    assert.match(fs.readFileSync(file,'utf8'),/当前会话已保留/);
    assert.doesNotMatch(fs.readFileSync(path.join(dist,'agent-runner.runtime.js'),'utf8'),/当前会话已保留/);
    assert.equal(applySameSession(root,{backupRoot:path.join(root,'backup')}).changed,false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
