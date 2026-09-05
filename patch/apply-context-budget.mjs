/** Version-checked, idempotent bridge into OpenClaw's own summarizer. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url));
const marker='/* pinkie-context-budget:v1 */';
const header=marker+'\nimport {compactionBudget as pinkieContextBudget} from "./pinkie-context-budget.mjs";\n';
function replaceOnce(text,from,to){
  if(text.split(from).length!==2)throw new Error('OpenClaw 压缩代码结构已变化，未覆盖：'+from.slice(0,90));
  return text.replace(from,to);
}
function hasOnce(text,value){return text.split(value).length===2;}
export function transform(kind,original){
  if(original.includes(marker))return original;
  let text=original;
  if(kind==='settings'){
    const legacyReserve='const configuredReserveTokens = toNonNegativeInt(compactionCfg?.reserveTokens);';
    const currentBudget='const contextTokenBudget = toPositiveInt(params.contextTokenBudget);';
    if(hasOnce(text,legacyReserve)){
      text=replaceOnce(text,legacyReserve,
        'const pinkieBudget = pinkieContextBudget(params.contextTokenBudget);\n\tconst configuredReserveTokens = pinkieBudget.reserve;');
      text=replaceOnce(text,'let reserveTokensFloor = resolveCompactionReserveTokensFloor(params.cfg);','let reserveTokensFloor = pinkieBudget.reserve;');
    }else if(hasOnce(text,currentBudget)){
      text=replaceOnce(text,currentBudget,currentBudget+'\n\tconst pinkieBudget = pinkieContextBudget(params.contextTokenBudget);');
      text=replaceOnce(text,`const requestedReserveTokens = Math.max(currentReserveTokens, DEFAULT_AGENT_COMPACTION_RESERVE_TOKENS_FLOOR);
\tconst targetReserveTokens = contextTokenBudget === void 0 ? requestedReserveTokens : resolveEffectiveCompactionReserveTokens({
\t\tcontextTokenBudget,
\t\treserveTokens: requestedReserveTokens
\t});`,'const targetReserveTokens = pinkieBudget.reserve;');
    }else throw new Error('OpenClaw 压缩代码结构已变化，未覆盖：agent settings reserve budget');
    text=replaceOnce(text,'const targetKeepRecentTokens = configuredKeepRecentTokens ?? currentKeepRecentTokens;',
      'const targetKeepRecentTokens = Math.min(configuredKeepRecentTokens ?? currentKeepRecentTokens, pinkieBudget.keepRecent);');
  }else if(kind==='preflight'){
    const legacyA='const threshold = Math.max(0, contextWindow - reserveTokens - softThreshold, Math.floor(params.minimumThresholdTokens ?? 0));';
    const legacyB='const threshold = Math.max(contextWindowTokens - reserveTokensFloor - softThresholdTokens, serverCompactionThreshold ?? 0);';
    const current=`const threshold = resolveCompactionThreshold({
\t\tcontextWindowTokens,
\t\treserveTokensFloor,
\t\tminimumThresholdTokens: responsesServerCompactionThreshold
\t});`;
    if(hasOnce(text,legacyA)){
      text=replaceOnce(text,legacyA,'const threshold = pinkieContextBudget(contextWindow).threshold;');
      text=replaceOnce(text,legacyB,'const threshold = pinkieContextBudget(contextWindowTokens).threshold;');
    }else if(hasOnce(text,current)){
      text=replaceOnce(text,current,'const threshold = pinkieContextBudget(contextWindowTokens).threshold;');
    }else throw new Error('OpenClaw 压缩代码结构已变化，未覆盖：preflight threshold');
  }else throw new Error('Unknown patch target');
  return header+text;
}
export function apply(root,{backupRoot}={}){
  const dist=path.join(root,'dist');
  const candidates=fs.readdirSync(dist).filter(n=>n.endsWith('.js'));
  const targets=[
    ['settings',['agent-settings-'],['configuredReserveTokens','targetReserveTokens']],
    ['preflight',['agent-runner.runtime-','agent-runner-memory-'],['minimumThresholdTokens','responsesServerCompactionThreshold']],
  ].map(([kind,prefixes,needles])=>{
    const names=candidates.filter(name=>prefixes.some(prefix=>name.startsWith(prefix))).filter(name=>{
      const source=fs.readFileSync(path.join(dist,name),'utf8');
      return source.includes(marker)||needles.some(needle=>source.includes(needle));
    });
    if(names.length!==1)throw new Error('OpenClaw 压缩代码结构已变化，无法唯一确认压缩模块：'+prefixes.join(' / '));
    const file=path.join(dist,names[0]),original=fs.readFileSync(file,'utf8');
    return {file,original,next:transform(kind,original)};
  });
  // Validate every target before changing any installed file; preserve other patches.
  const helper=fs.readFileSync(path.join(here,'../services/context/budget.mjs'),'utf8');
  const helperPath=path.join(dist,'pinkie-context-budget.mjs');
  const changed=targets.filter(t=>t.original!==t.next);
  const helperChanged=!fs.existsSync(helperPath)||fs.readFileSync(helperPath,'utf8')!==helper;
  if(!changed.length&&!helperChanged)return {changed:false};
  const backup=backupRoot||path.join(os.homedir(),'Library/Application Support/SuperPinkie/backups','context-runtime-'+Date.now());
  fs.mkdirSync(backup,{recursive:true,mode:0o700});
  for(const t of changed)fs.copyFileSync(t.file,path.join(backup,path.basename(t.file)));
  if(fs.existsSync(helperPath))fs.copyFileSync(helperPath,path.join(backup,'pinkie-context-budget.mjs'));
  for(const t of changed)if(fs.readFileSync(t.file,'utf8')!==t.original)throw new Error('压缩模块正在被更新，未覆盖');
  fs.writeFileSync(helperPath,helper);
  for(const t of changed)fs.writeFileSync(t.file,t.next);
  return {changed:true,backup,files:changed.map(t=>path.basename(t.file))};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let root=process.env.OPENCLAW_ROOT;
  if(!root){
    const entries=execFileSync(process.platform==='win32'?'where':'which',['openclaw'],{encoding:'utf8'}).trim().split(/\r?\n/);
    for(const entry of entries){
      const dir=path.dirname(fs.realpathSync(entry));
      root=[dir,path.join(dir,'node_modules/openclaw')].find(candidate=>fs.existsSync(path.join(candidate,'dist')));
      if(root)break;
    }
  }
  if(!root)throw new Error('无法找到 OpenClaw 包目录，请明确设置 OPENCLAW_ROOT');
  console.log(JSON.stringify(apply(root,{backupRoot:process.env.PINKIE_PATCH_BACKUP_ROOT||undefined})));
}
