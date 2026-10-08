/** Empty tool arrays are heartbeat metadata, not a boundary in thinking text. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const marker = '/* pinkie-work-thinking:v1 */';
const before = 'if (choiceDelta.tool_calls) {';
const after = `${marker}\n\t\t\t\t\tif (Array.isArray(choiceDelta.tool_calls) && choiceDelta.tool_calls.length > 0) {`;
export function transform(source) {
  if (source.includes(marker)) return source;
  if (source.split(before).length !== 2) throw new Error('OpenAI 思考解析结构已变化，未覆盖');
  return source.replace(before, after);
}
export function apply(root, {backupRoot} = {}) {
  const dir = path.join(root, 'node_modules/@openclaw/ai/dist');
  const names = fs.readdirSync(dir).filter(n => /^openai-completions-[^.]+\.mjs$/.test(n))
    .filter(n => {const s=fs.readFileSync(path.join(dir,n),'utf8');return s.includes(before)||s.includes(marker);});
  if(names.length!==1) throw new Error('无法唯一确认 OpenAI 思考解析模块');
  const file=path.join(dir,names[0]),source=fs.readFileSync(file,'utf8'),next=transform(source);
  if(next!==source){
    if(backupRoot){fs.mkdirSync(backupRoot,{recursive:true});const backup=path.join(backupRoot,names[0]);if(!fs.existsSync(backup))fs.copyFileSync(file,backup);}
    const tmp=file+'.work-thinking';fs.writeFileSync(tmp,next,{mode:fs.statSync(file).mode});fs.renameSync(tmp,file);
  }
  return {file,changed:source!==next};
}
if(process.argv[1] && fileURLToPath(import.meta.url)===path.resolve(process.argv[1])) {
  if(!process.env.OPENCLAW_ROOT)throw new Error('OPENCLAW_ROOT is required');
  console.log(JSON.stringify(apply(process.env.OPENCLAW_ROOT,{backupRoot:process.env.PINKIE_PATCH_BACKUP})));
}
