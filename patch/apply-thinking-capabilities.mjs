/** Respect explicit per-route capability metadata even on custom providers.
 * Legacy kernels recognize selected built-in providers only, silently reducing
 * a declared GPT-6.1/custom route to a generic or off-only profile. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const marker = '/* pinkie-thinking-capabilities:v1 */';
const anchor = 'const context = resolveThinkingPolicyContext(params);';
export function transform(source) {
  if (source.includes(marker)) return source;
  if (source.split(anchor).length !== 2) throw new Error('模型能力解析结构已变化，未覆盖');
  return source.replace(anchor, `${anchor}
  ${marker}
  const declared = context.compat?.supportedReasoningEfforts;
  if (context.reasoning !== false && Array.isArray(declared) && declared.length > 0 && declared.length <= 10) {
    const normalized = declared.map(value => typeof value === "string" ? normalizeThinkLevel(value === "none" ? "off" : value) : undefined);
    if (normalized.every(Boolean)) {
      const levels = [...new Set(normalized)].map(id => ({id, label: id, rank: THINKING_LEVEL_RANKS[id]})).sort((a,b) => a.rank - b.rank);
      return {levels, defaultLevel: levels.some(level => level.id === "medium") ? "medium" : levels[0].id};
    }
  }
  // Missing reasoning metadata on a configured fixed endpoint is not a
  // declaration of five adjustable native efforts. The SDK omits the effort
  // parameter for these models, so the picker must expose the same contract.
  if (context.reasoning == null && params.catalog?.some(entry => entry.id === params.model && entry.provider === params.provider)) {
    return {levels:[{id:"off",label:"off",rank:THINKING_LEVEL_RANKS.off}],defaultLevel:"off"};
  }`).replace('if (context.reasoning === false) return buildOffOnlyThinkingProfile();',
    'if (context.reasoning === false || (!declared?.length && params.catalog?.some(entry => entry.id === params.model && entry.provider === params.provider))) return buildOffOnlyThinkingProfile();');
}
export function transformModelUtils(source) {
  const flag='/* pinkie-sdk-thinking-capabilities:v1 */';if(source.includes(flag))return source;
  const anchor='const thinkingLevelMap = resolveThinkingLevelMap(model);';
  const start=source.indexOf('function getSupportedThinkingLevels(model) {');
  const end=source.indexOf('function clampThinkingLevel',start);
  if(start<0||end<0)throw Error('SDK能力结构已变化，未覆盖');
  const part=source.slice(start,end);if(!part.includes(anchor))throw Error('SDK等级映射缺失');
  const next=part.replace(anchor,`${anchor}
  ${flag}
  const declared=model.compat?.supportedReasoningEfforts;
  if(Array.isArray(declared)&&declared.length>0) {
    const levels=new Set(declared.map(level=>level==="none"?"off":level));
    const supported=EXTENDED_THINKING_LEVELS.filter(level=>levels.has(level)&&thinkingLevelMap?.[level]!==null);
    if(supported.length)return supported;
  }`);
  return source.slice(0,start)+next+source.slice(end);
}
export function transformCompletions(source) {
  const flag='/* pinkie-sdk-effort-payload:v1 */';if(source.includes(flag))return source;
  const before='const reasoningEffort = clampedReasoning === "off" ? void 0 : clampedReasoning === "max" ? "xhigh" : clampedReasoning;';
  if(source.split(before).length!==2)throw Error('SDK请求等级结构已变化，未覆盖');
  let next=source.replace(before,`${flag}
  const reasoningEffort = clampedReasoning === "off" ? void 0 : clampedReasoning === "max" && !model.compat?.supportedReasoningEfforts?.includes("max") ? "xhigh" : clampedReasoning;`);
  const off='const offValue = model.thinkingLevelMap?.off;';
  if(next.split(off).length!==2)throw Error('SDK关闭档位结构已变化，未覆盖');
  next=next.replace(off,'const offValue = model.thinkingLevelMap?.off ?? (model.compat?.supportedReasoningEfforts?.includes("none") ? "none" : model.compat?.supportedReasoningEfforts?.includes("off") ? "off" : undefined);');
  return next;
}
export function apply(root, {backupRoot} = {}) {
  const dir = path.join(root, 'dist');
  const files = fs.readdirSync(dir).filter(name => /^thinking-[^.]+\.js$/.test(name))
    .filter(name => fs.readFileSync(path.join(dir, name), 'utf8').includes(anchor));
  if (!files.length) {
    // This compatibility patch targets the sealed 2026.7 SDK. The newer
    // provider-policy runtime has a different contract and must not receive
    // a partial legacy rewrite. Report that explicitly to the installer.
    const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
    const modern=/^2026\.(?:10|11|12)\./.test(version)&&fs.readdirSync(dir).some(name=>{
      if(!/^thinking-[^.]+\.mjs$/.test(name))return false;
      const source=fs.readFileSync(path.join(dir,name),'utf8');
      return source.includes('function resolveModelThinkingProfile(params)')&&source.includes('appendCatalogAdvancedThinkingLevels(profile, context.compat');
    });
    if(modern)return {changed:false,legacyOnly:true,reason:'2026.10+ provider-policy runtime; legacy SDK patch not applicable'};
  }
  if (files.length !== 1) throw new Error('无法唯一确认模型能力模块');
  const file = path.join(dir, files[0]), source = fs.readFileSync(file, 'utf8'), next = transform(source);
  const changes=[{file,source,next}];
  const sdk=path.join(root,'node_modules/@openclaw/ai/dist');
  for(const [pattern,fn] of [[/^model-utils-[^.]+\.mjs$/,transformModelUtils],[/^openai-completions-[^.]+\.mjs$/,transformCompletions]]) {
    const candidates=fs.readdirSync(sdk).filter(name=>pattern.test(name));
    if(candidates.length!==1)throw Error('无法唯一确认SDK档位模块');
    const file=path.join(sdk,candidates[0]),source=fs.readFileSync(file,'utf8');changes.push({file,source,next:fn(source)});
  }
  for(const {file,source,next} of changes)if(source!==next) {
    if(backupRoot){fs.mkdirSync(backupRoot,{recursive:true});const backup=path.join(backupRoot,path.basename(file));if(!fs.existsSync(backup))fs.copyFileSync(file,backup);}
    fs.writeFileSync(file+'.pinkie-capabilities',next,{mode:fs.statSync(file).mode});fs.renameSync(file+'.pinkie-capabilities',file);
  }
  return {file,changed:changes.some(item=>item.source!==item.next),files:changes.map(item=>({file:item.file,changed:item.source!==item.next}))};
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (!process.env.OPENCLAW_ROOT) throw new Error('OPENCLAW_ROOT is required');
  console.log(JSON.stringify(apply(process.env.OPENCLAW_ROOT, {backupRoot:process.env.PINKIE_PATCH_BACKUP})));
}
