import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apply,transform} from '../patch/apply-compaction-boundary-recovery.mjs';

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
  assert.match(output,/effectiveFirstKeptEntryId = resolveRecoveryFirstKeptEntryId/);
  assert.equal((output.match(/firstKeptEntryId: effectiveFirstKeptEntryId,/g)||[]).length,3);
  assert.equal(transform(output),output);
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
