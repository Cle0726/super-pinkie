import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {compactionBudget,sessionContextWindow} from '../services/context/budget.mjs';
import {apply,transform} from '../patch/apply-context-budget.mjs';

const policyHome=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-native-budget-2026-'));
const policyPath=path.join(policyHome,'Library/Application Support/SuperPinkie/context-policy.json');
fs.mkdirSync(path.dirname(policyPath),{recursive:true});
process.env.HOME=policyHome;
process.env.PINKIE_STATE_ROOT=path.join(policyHome,'Library/Application Support/SuperPinkie');
fs.writeFileSync(policyPath,fs.readFileSync(new URL('../services/context/policy.json',import.meta.url),'utf8'));

// 2026.10 shapes: .mjs bundles; the settings module no longer has the legacy
// `configuredReserveTokens` anchor, preflight uses a distinct helper, and
// sessions.list projects rows through listProjectedSessions(params).
const settings2026=`function toPositiveInt(value){return value;}
function settings(params){
const currentReserveTokens=16384,currentKeepRecentTokens=20000;
const compactionCfg=params.cfg?.agents?.defaults?.compaction;
const configuredKeepRecentTokens=toPositiveInt(compactionCfg?.keepRecentTokens);
const contextTokenBudget = toPositiveInt(params.contextTokenBudget);
const requestedReserveTokens = Math.max(currentReserveTokens, DEFAULT_AGENT_COMPACTION_RESERVE_TOKENS_FLOOR);
\tconst targetReserveTokens = contextTokenBudget === void 0 ? requestedReserveTokens : resolveEffectiveCompactionReserveTokens({
\t\tcontextTokenBudget,
\t\treserveTokens: requestedReserveTokens
\t});
const targetKeepRecentTokens = configuredKeepRecentTokens ?? currentKeepRecentTokens;
return {reserve:targetReserveTokens,recent:targetKeepRecentTokens};}`;
const preflight2026=`function pre(contextWindowTokens,reserveTokensFloor,responsesServerCompactionThreshold){
const threshold = resolveCompactionThreshold({
\t\tcontextWindowTokens,
\t\treserveTokensFloor,
\t\tminimumThresholdTokens: responsesServerCompactionThreshold
\t});
return threshold;}`;
const sessions2026=`const sessionsListHandler = sessionReadHandlers["sessions.list"];
function listProjectedSessions(params) {
\treturn projection.withSelectionPreparation(async () => {
\t\treturn withReadySessionRows(projection, () => [], () => {
\t\t\tconst sessions = selection.entries.flatMap(([key]) => {
\t\t\t\treturn [{ key }];
\t\t\t});
\t\t\tconst result = buildSessionsListResult(prepared, selection, sessions, cfg);
\t\t\t\tparams.onResult?.(result, sharedRows);
\t\t\treturn result;
\t\t});
\t});
}`;

function executable(source,name){return Function('pinkieContextBudget','pinkieSessionContextWindow',source.replace(/^import .*$/gm,'')+';return '+name)(compactionBudget,sessionContextWindow);}

test('2026.10 settings and preflight adopt the shared budget', () => {
  const runSettings=executable(transform('settings',settings2026),'settings');
  const runPreflight=executable(transform('preflight',preflight2026),'pre');
  for (const window of [16000,128000,1000000]) {
    const expected=compactionBudget(window);
    const settings=runSettings({contextTokenBudget:window,cfg:{agents:{defaults:{compaction:{keepRecentTokens:900000}}}}});
    assert.equal(settings.reserve,expected.reserve);
    assert.equal(settings.recent,expected.keepRecent);
    assert.equal(runPreflight(window,20000,window*0.9),expected.threshold);
  }
});

test('2026.10 projected sessions.list rows carry the same budget', () => {
  const code=transform('sessions',sessions2026);
  assert.match(code,/pinkie-context-budget:sessions:v3/);
  assert.match(code,/\s*for \(const pinkieSession of result\.sessions\)/);
  assert.match(code,/pinkieSession\.contextTokens = pinkieWindow;/);
  assert.match(code,/params\.onResult\?\.\(result, sharedRows\);/,'native callback order is kept');
  assert.equal(transform('sessions',code),code,'idempotent');
});

test('2026.10 targets .mjs chunks and validates before writing', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-context-2026-'));
  try {
    const dist=path.join(root,'dist');fs.mkdirSync(dist);
    const a=path.join(dist,'agent-settings-TEST.mjs');
    const b=path.join(dist,'agent-runner-memory-TEST.mjs');
    const c=path.join(dist,'session-utils-list-TEST.mjs');
    fs.writeFileSync(a,settings2026);fs.writeFileSync(b,'different future version');fs.writeFileSync(c,sessions2026);
    assert.throws(()=>apply(root),/结构已变化/);
    assert.equal(fs.readFileSync(a,'utf8'),settings2026,'nothing written before every target validates');
    fs.writeFileSync(b,preflight2026);
    const backup=path.join(root,'backup');
    const result=apply(root,{backupRoot:backup});
    assert.equal(result.changed,true);
    assert.deepEqual(result.files.sort(),['agent-runner-memory-TEST.mjs','agent-settings-TEST.mjs','session-utils-list-TEST.mjs']);
    assert.ok(fs.existsSync(path.join(dist,'pinkie-context-budget.mjs')));
    assert.equal(apply(root,{backupRoot:backup}).changed,false);
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
});
