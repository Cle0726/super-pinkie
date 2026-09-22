import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apply,transform} from '../patch/apply-compaction-boundary-recovery.mjs';
import {transform as transformSameSession} from '../patch/apply-same-session-recovery.mjs';

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
