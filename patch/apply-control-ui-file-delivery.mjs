/** Render local MEDIA as native, verified deliverables; keep remote media intact. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const marker = '/* pinkie-control-ui-file-delivery:v1 */';
const helpers = String.raw`function laolaoDeliveryPath(e){if(typeof e!=="string")return null;let t=e.trim();if(t.startsWith("file://")){try{const e=new URL(t);if(e.host&&e.host!=="localhost")return null;t=decodeURIComponent(e.pathname);if(/^\/[a-z]:\//i.test(t))t=t.slice(1)}catch{return null}}if(/\/\.openclaw\/media\/inbound(?:\/|$)/i.test(t.replace(/\\/g,"/")))return null;if(/^(?:\/Users\/[^/]+\/|\/home\/[^/]+\/|[a-z]:[\\/]Users[\\/][^\\/]+[\\/]|~[\\/])/i.test(t)&&!t.includes("\0"))return t;return null}function laolaoDeliveryAttachments(e){const t=new Set;let n=0;return e.filter(e=>{const r=laolaoDeliveryPath(e.attachment?.url);if(!r)return true;const i=/^[a-z]:/i.test(r)?r.replace(/\\/g,"/").toLowerCase():r;if(t.has(i)||n>=6)return false;t.add(i);n++;return true})}`;
const localCard = 'const d=laolaoDeliveryPath(e.url);if(d)return s`<div class="chat-assistant-attachment-card laolao-delivery-card" data-laolao-material-path=${d} data-laolao-material-kind=${e.kind} data-laolao-material-name=${e.label} @laolao-delivery-ready=${()=>a?.()}></div>`;';

function replaceOnce(text, from, to) {
  if (text.split(from).length !== 2) throw new Error('成品卡片补丁无法确认聊天页结构，未覆盖：' + from.slice(0, 90));
  return text.replace(from, to);
}

export function transform(original) {
  if (original.includes(marker)) return original;
  let next = replaceOnce(original, 'function pS(e){', marker + helpers + 'function pS(e){');
  next = replaceOnce(next,
    'if(tS(n,r))continue;let e=nS(n,r)?`audio`:rS(n,r)?`video`:`document`;',
    'if(tS(n,r)&&!laolaoDeliveryPath(n))continue;let e=tS(n,r)?`image`:nS(n,r)?`audio`:rS(n,r)?`video`:`document`;');
  next = replaceOnce(next,
    'let g=AS(oS(e),h)',
    'let g=AS(oS(e).filter(t=>!(laolaoDeliveryPath(t.url)&&aS(e).some(n=>n.path===t.url))),h)');
  next = replaceOnce(next,
    '${e.map(({attachment:e})=>{let o=JS(e.url,t,n,r,i)',
    '${laolaoDeliveryAttachments(e).map(({attachment:e})=>{' + localCard + 'let o=JS(e.url,t,n,r,i)');
  // Move the normal message's attachment interpolation in the Lit template,
  // rather than moving rendered nodes (which would break Lit's part anchors).
  const attachments = '${XS(x,n.localMediaPreviewRoots??[],n.basePath,n.assistantAttachmentAuthToken,n.onRequestUpdate,n.onAssistantAttachmentLoaded)}';
  next = replaceOnce(next, '            ${jS(g,h)}\n            ' + attachments + '\n', '            ${jS(g,h)}\n');
  next = replaceOnce(next, '          `}\n      ${le>1?', '            ' + attachments + '\n          `}\n      ${le>1?');
  return next;
}

export function apply(root, {backupRoot} = {}) {
  const assets = path.join(root, 'dist/control-ui/assets');
  const names = fs.readdirSync(assets).filter(name=>/^chat-page-[\w-]+\.js$/.test(name));
  if(names.length!==1)throw new Error('无法唯一确认聊天页模块：'+names.join(', '));
  const file=path.join(assets,names[0]),original=fs.readFileSync(file,'utf8'),next=transform(original);
  if(next===original)return {changed:false,file:names[0]};
  if(fs.readFileSync(file,'utf8')!==original)throw new Error('聊天页正在更新，未覆盖。');
  const backup=backupRoot||path.join(os.homedir(),'Library/Application Support/SuperPinkie/backups','file-delivery-'+Date.now());
  fs.mkdirSync(backup,{recursive:true,mode:0o700});fs.copyFileSync(file,path.join(backup,names[0]));fs.writeFileSync(file,next);
  return {changed:true,file:names[0],backup};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.env.OPENCLAW_ROOT)throw new Error('请明确设置 OpenClaw 包目录。');
  console.log(JSON.stringify(apply(process.env.OPENCLAW_ROOT,{backupRoot:process.env.PINKIE_PATCH_BACKUP_ROOT})));
}
