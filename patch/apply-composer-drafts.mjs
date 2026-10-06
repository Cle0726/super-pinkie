/** Keep the native per-session draft store, with immediate saves and no draft eviction. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const marker = '/* pinkie-composer-drafts:v1 */';
function refreshCache(url) {
  const [file,query='']=url.split('?'),params=new URLSearchParams(query);
  params.set('pinkie-drafts','1');return file+'?'+params;
}

function replaceOne(source, pattern, replacement) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error('原生草稿保存结构已变化，未覆盖');
  return source.replace(pattern, replacement);
}

export function transform(source) {
  if (source.includes(marker)) return source;
  let next = replaceOne(source,
    /let (\w+)=Object\.entries\((\w+)\.sessions\)\.toSorted\(([^;]+?)\)\.slice\(0,(\w+)\);/g,
    (_, rows, store, compare, limit) => `let pinkieQueueOnlyCount=0;let ${rows}=Object.entries(${store}.sessions).toSorted(${compare}).filter(([,entry])=>Boolean(entry.draft)||pinkieQueueOnlyCount++<${limit});`);
  next = replaceOne(next,
    /persistChangedState\(\)\{let (\w+)=this\.getState\(\);this\.lastPersisted\?\.chatQueue!==\1\?\.chatQueue&&this\.persistNow\(\)\}/g,
    'persistChangedState(){this.persistNow()}');
  next = replaceOne(next,
    /start\(\)\{let (\w+)=this\.getState\(\);\1&&\(this\.ready=!0,this\.lastPersisted=this\.snapshot\(\1\)\)\}/g,
    (_, state) => `start(){let ${state}=this.getState();if(${state}){this.ready=!0;this.lastPersisted=this.snapshot(${state});this.pinkieDraftFlush??=()=>this.persistNow();globalThis.addEventListener?.("pagehide",this.pinkieDraftFlush);globalThis.addEventListener?.("beforeunload",this.pinkieDraftFlush);globalThis.document?.addEventListener("visibilitychange",this.pinkieDraftFlush)}}`);
  next = replaceOne(next,
    /stop\(\)\{this\.persistNow\(\),this\.ready=!1,this\.clearTimer\(\)\}/g,
    'stop(){this.persistNow();this.ready=!1;this.clearTimer();globalThis.removeEventListener?.("pagehide",this.pinkieDraftFlush);globalThis.removeEventListener?.("beforeunload",this.pinkieDraftFlush);globalThis.document?.removeEventListener("visibilitychange",this.pinkieDraftFlush)}');
  return marker + '\n' + next;
}

export function apply(root, {backupRoot} = {}) {
  const ui = path.join(root, 'dist/control-ui'), assets = path.join(ui, 'assets');
  const files = fs.readdirSync(assets).filter(name => name.endsWith('.js'));
  const composer = files.filter(name => fs.readFileSync(path.join(assets,name),'utf8').includes('openclaw.control.chatComposer.v1:'));
  if (composer.length !== 1) throw new Error('未找到唯一的原生草稿模块');
  const moduleName = composer[0], moduleFile = path.join(assets,moduleName);
  const changes = new Map();
  const original = fs.readFileSync(moduleFile,'utf8');
  const patched = transform(original);
  if (patched !== original) changes.set(moduleFile,patched);
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const importPattern = new RegExp(escaped+'(?:\\?[^"\x27`]*?)?(?=["\x27`])','g');
  for (const name of files) {
    if (name === moduleName) continue;
    const file = path.join(assets,name), source = fs.readFileSync(file,'utf8');
    const next = source.replace(importPattern, refreshCache);
    if (next !== source) changes.set(file,next);
  }
  const indexFile = path.join(ui,'index.html'), index = fs.readFileSync(indexFile,'utf8');
  const html = index.replace(/((?:src|href)=")((?:\/|\.\/)?assets\/[^"?]+\.js(?:\?[^" ]*)?)(")/g,
    (_, before, asset, after) => before+refreshCache(asset)+after);
  if (html !== index) changes.set(indexFile,html);
  if (!changes.size) return {changed:false,files:[]};
  const backup = backupRoot || path.join(root,'.pinkie-backups',`drafts-${Date.now()}`);
  fs.mkdirSync(backup,{recursive:true});
  for (const [file,next] of changes) {
    fs.copyFileSync(file,path.join(backup,path.basename(file)));
    const temp = file+'.pinkie-drafts-tmp';
    fs.writeFileSync(temp,next); fs.renameSync(temp,file);
  }
  return {changed:true,files:[...changes.keys()],backup};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.OPENCLAW_ROOT) throw new Error('Set OPENCLAW_ROOT');
  console.log(JSON.stringify(apply(process.env.OPENCLAW_ROOT)));
}
