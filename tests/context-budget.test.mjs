import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {compactionBudget} from '../services/context/budget.mjs';
import {apply,transform} from '../patch/apply-context-budget.mjs';
const policyHome=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-native-budget-'));
const policyPath=path.join(policyHome,'Library/Application Support/SuperPinkie/context-policy.json');
fs.mkdirSync(path.dirname(policyPath),{recursive:true});
const installedPolicy=JSON.parse(fs.readFileSync(new URL('../services/context/policy.json',import.meta.url),'utf8'));
fs.writeFileSync(policyPath,JSON.stringify(installedPolicy));
process.env.HOME=policyHome;
const settings=`function settings(params){
const compactionCfg=params.cfg?.agents?.defaults?.compaction;
const configuredReserveTokens = toNonNegativeInt(compactionCfg?.reserveTokens);
const configuredKeepRecentTokens=900000,currentKeepRecentTokens=900000;
let reserveTokensFloor = resolveCompactionReserveTokensFloor(params.cfg);
const targetKeepRecentTokens = configuredKeepRecentTokens ?? currentKeepRecentTokens;
return {reserve:configuredReserveTokens,floor:reserveTokensFloor,recent:targetKeepRecentTokens};
}`;
const preflight=`function gate(contextWindow,reserveTokens,softThreshold,params){
const threshold = Math.max(0, contextWindow - reserveTokens - softThreshold, Math.floor(params.minimumThresholdTokens ?? 0));
return threshold;}
function pre(contextWindowTokens,reserveTokensFloor,softThresholdTokens,serverCompactionThreshold){
const threshold = Math.max(contextWindowTokens - reserveTokensFloor - softThresholdTokens, serverCompactionThreshold ?? 0);
return threshold;}`;
const currentSettings=`function toPositiveInt(value){return value;}
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
const currentPreflight=`function pre(contextWindowTokens,reserveTokensFloor,responsesServerCompactionThreshold){
const threshold = resolveCompactionThreshold({
\t\tcontextWindowTokens,
\t\treserveTokensFloor,
\t\tminimumThresholdTokens: responsesServerCompactionThreshold
\t});
return threshold;}`;
function executable(source,name){return Function('pinkieContextBudget',source.replace(/^import .*$/gm,'')+';return '+name)(compactionBudget);}
test('ultra-long retention follows the installed large-window policy',()=>{
  for(const window of [4096,16000,32768,128000,258400,1000000]){
    const resolved=window;
    const b=compactionBudget(window);assert.equal(b.window,resolved);
    assert.equal(installedPolicy.triggerRatio,.85);
    assert.equal(b.threshold,Math.floor(resolved*.85));
    assert.equal(resolved-b.reserve,b.threshold);
    const requestedKeep=Math.floor(resolved*installedPolicy.keepRecentRatio);
    const workingHeadroom=Math.max(1024,Math.floor(resolved*.05));
    assert.equal(b.keepRecent,Math.min(requestedKeep,Math.max(1,b.threshold-workingHeadroom)));
    assert.equal(b.threshold-1>=b.threshold,false);assert.equal(b.threshold>=b.threshold,true);
  }
});
test('native compaction settings no longer use a fixed 60k reserve or 40k tail',()=>{
  const run=executable(transform('settings',settings),'settings');
  for(const contextTokenBudget of [16000,128000,1000000]){
    const expected=compactionBudget(contextTokenBudget),actual=run({contextTokenBudget});
    assert.equal(actual.reserve,expected.reserve);
    assert.equal(actual.floor,actual.reserve);assert.equal(actual.recent,expected.keepRecent);
  }
});
test('preflight uses the same configured threshold even with server-side compaction',()=>{
  const code=transform('preflight',preflight),gate=executable(code,'gate'),pre=executable(code,'pre');
  for(const w of [16000,128000,1000000]){
    const expected=compactionBudget(w).threshold;
    assert.equal(gate(w,60000,4000,{minimumThresholdTokens:w*.9}),expected);
    assert.equal(pre(w,20000,4000,w*.9),expected);
  }
});
test('current OpenClaw settings and preflight structures keep the same 85 percent policy',()=>{
  const runSettings=executable(transform('settings',currentSettings),'settings');
  const runPreflight=executable(transform('preflight',currentPreflight),'pre');
  for(const contextTokenBudget of [16000,128000,1000000]){
    const expected=compactionBudget(contextTokenBudget);
    const actual=runSettings({contextTokenBudget,cfg:{agents:{defaults:{compaction:{keepRecentTokens:900000}}}}});
    assert.equal(actual.reserve,expected.reserve);assert.equal(actual.recent,expected.keepRecent);
    assert.equal(runPreflight(contextTokenBudget,20000,contextTokenBudget*.9),expected.threshold);
  }
});
test('patch is idempotent and validates every target before writing; backups preserve original files',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-context-patch-'));
  try{
    const dist=path.join(temp,'dist');fs.mkdirSync(dist);
    const a=path.join(dist,'agent-settings-test.js'),b=path.join(dist,'agent-runner.runtime-test.js');
    fs.writeFileSync(a,settings);fs.writeFileSync(b,'different future version');
    assert.throws(()=>apply(temp),/结构已变化/);assert.equal(fs.readFileSync(a,'utf8'),settings);
    fs.writeFileSync(b,preflight);
    const backupRoot=path.join(temp,'backup');assert.equal(apply(temp,{backupRoot}).changed,true);
    assert.equal(fs.readFileSync(path.join(backupRoot,path.basename(a)),'utf8'),settings);
    assert.equal(apply(temp,{backupRoot}).changed,false);
    assert.equal(transform('settings',fs.readFileSync(a,'utf8')),fs.readFileSync(a,'utf8'));
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('packaged app includes party identities and shared context policy',()=>{
  const build=fs.readFileSync(new URL('../desktop/macos/build.sh',import.meta.url),'utf8');
  assert.match(build,/services\/party\/identities\.json/);assert.match(build,/context_budget\.py setup\.py budget\.mjs policy\.json/);
  const theme=fs.readFileSync(new URL('../installer/macos/apply-theme.sh',import.meta.url),'utf8');
  assert.match(theme,/apply-context-budget\.mjs/);assert.match(theme,/services\/context\/setup\.py/);
});
