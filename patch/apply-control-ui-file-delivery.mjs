/** Render local MEDIA as native, verified deliverables; keep remote media intact. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {refreshPrecompressed} from './lib-precompressed.mjs';

const marker = '/* pinkie-control-ui-file-delivery:v1 */';
const currentMarker = '/* pinkie-control-ui-file-delivery:v2 */';
/** Delivery helper source. __pkHtml is replaced with the bundle's own lit tag. */
const helpers = [
  'function laolaoDeliveryPath(e){if(typeof e!=="string")return null;let t=e.trim();',
  'if(t.startsWith("file://")){try{const u=new URL(t);if(u.host&&u.host!=="localhost")return null;',
  't=decodeURIComponent(u.pathname);if(/^\\/[a-z]:\\//i.test(t))t=t.slice(1)}catch{return null}}',
  'const p=t.replace(/\\\\/g,"/");',
  'if(/\\/\\.openclaw\\/media\\/inbound(?:\\/|$)/i.test(p))return null;',
  'if(/^(?:\\/Users\\/[^/]+\\/|\\/home\\/[^/]+\\/|[a-z]:[\\\\/]Users[\\\\/][^\\\\/]+[\\\\/]|~[\\\\/])/i.test(t)&&!t.includes("\\u0000"))return t;',
  'return null}',
  'function laolaoDeliveryItems(e){const seen=new Set;const out=[];for(const item of e||[]){',
  'const url=laolaoDeliveryPath(item?.attachment?.url);if(!url)continue;',
  'const key=/^[a-z]:/i.test(url)?url.replace(/\\\\/g,"/").toLowerCase():url;',
  'if(seen.has(key))continue;seen.add(key);out.push(item);if(out.length>=6)break}',
  'return out}',
  'function laolaoDeliveryCards(items,toasts){',
  'if(!toasts||!laolaoDeliveryItems(items).length)return toasts;',
  'const cards=laolaoDeliveryItems(items).map(item=>{const url=laolaoDeliveryPath(item.attachment.url);',
  'return __pkHtml`<div class="chat-assistant-attachment-card laolao-delivery-card"',
  ' data-laolao-material-path=${url} data-laolao-material-kind=${item.attachment.kind}',
  ' data-laolao-material-name=${item.attachment.label}></div>`});',
  'return [...cards,toasts]}',
].join('');
const localCard = 'const d=laolaoDeliveryPath(e.url);if(d)return s`<div class="chat-assistant-attachment-card laolao-delivery-card" data-laolao-material-path=${d} data-laolao-material-kind=${e.kind} data-laolao-material-name=${e.label} @laolao-delivery-ready=${()=>a?.()}></div>`;';

function replaceOnce(text, from, to) {
  if (text.split(from).length !== 2) throw new Error('成品卡片补丁无法确认聊天页结构，未覆盖：' + from.slice(0, 90));
  return text.replace(from, to);
}

/**
 * OpenClaw 2026.10: the chat renderer lives in control-ui-boot-chat-*.js and
 * every helper name is minified again, so 2026.7's `pS`/`tS` anchors are gone.
 * Delivery cards now hang off the toast-slot expression (the first argument of
 * the expression that also renders the message's attachment chips), which
 * keeps Lit's part anchors untouched.
 */
function transformCurrent(original) {
  if (original.includes(currentMarker)) return original;
  // ld() is imported from the shared core chunk, not defined in this file.
  if (!/\{images:\w+,attachments:\w+,[^}]*\}=ld\(/u.test(original) || !original.includes('chat-bubble--with-files')) {
    throw new Error('成品卡片补丁无法确认 2026.10 聊天页结构，未覆盖');
  }
  const template = /(?:return|:)\s*([\w$]+)`\s*<div\s+class=/u.exec(original)?.[1];
  if (!template) throw new Error('成品卡片补丁无法确认 lit 模板标签，未覆盖');
  let next = replaceOnce(original, 'function p_(', `${currentMarker}\n${helpers.replace(/__pkHtml/gu, template)}function p_(`);
  // A real local deliverable is no longer a video preview of the user bubble.
  const videoFilter = '.filter((e=>e.type===`attachment`&&e.attachment.kind===`video`))';
  if (next.includes(videoFilter)) {
    next = next.replace(videoFilter,
      '.filter((e=>e.type===`attachment`&&e.attachment.kind===`video`&&!laolaoDeliveryPath(e.attachment.url)))');
  }
  // Drop delivery chips from the attachment strip so only the card announces a
  // local file; O is the attachment list of this message.
  const strip = '${hc(le?T:O,A,r,n.onAssistantAttachmentLoaded,';
  if (next.split(strip).length !== 2) throw new Error('成品卡片补丁无法确认附件条，未覆盖');
  next = next.replace(strip, '${hc(le?T:O.filter(e=>!laolaoDeliveryPath(e?.attachment?.url)),A,r,n.onAssistantAttachmentLoaded,');
  // Wrap the message toasts with the delivery cards (t = toast slot, O = chips).
  const toast = '${zu(te)}';
  if (next.split(toast).length !== 2) throw new Error('成品卡片补丁无法确认消息插槽，未覆盖');
  next = next.replace(toast, '${laolaoDeliveryCards(laolaoDeliveryItems(O),zu(te))}');
  return next;
}

export function transform(original) {
  if (original.includes(marker) || original.includes(currentMarker)) return original;
  try {
    return transformCurrent(original);
  } catch (error) {
    if (original.includes('control-ui-boot-chat') || !original.includes('function pS(e){')) throw error;
  }
  let next = replaceOnce(original, 'function pS(e){', marker + helpers + 'function pS(e){');
  next = replaceOnce(next,
    'if(tS(n,r))continue;let e=nS(n,r)?`audio`:rS(n,r)?`video`:`document`;',
    'if(tS(n,r)&&!laolaoDeliveryPath(n))continue;let e=tS(n,r)?`image`:nS(n,r)?`audio`:rS(n,r)?`video`:`document`;');
  next = replaceOnce(next,
    'let g=AS(oS(e),h)',
    'let g=AS(oS(e).filter(t=>!(laolaoDeliveryPath(t.url)&&aS(e).some(n=>n.path===t.url))),h)');
  next = replaceOnce(next,
    '${e.map(({attachment:e})=>{let o=JS(e.url,t,n,r,i)',
    '${e.filter(({attachment:e})=>!laolaoDeliveryPath(e.url)).map(({attachment:e})=>{' + localCard + 'let o=JS(e.url,t,n,r,i)');
  // Move the normal message's attachment interpolation in the Lit template,
  // rather than moving rendered nodes (which would break Lit's part anchors).
  const attachments = '${XS(x,n.localMediaPreviewRoots??[],n.basePath,n.assistantAttachmentAuthToken,n.onRequestUpdate,n.onAssistantAttachmentLoaded)}';
  next = replaceOnce(next, '            ${jS(g,h)}\n            ' + attachments + '\n', '            ${jS(g,h)}\n');
  next = replaceOnce(next, '          `}\n      ${le>1?', '            ' + attachments + '\n          `}\n      ${le>1?');
  return next;
}

export function apply(root, {backupRoot} = {}) {
  const assets = path.join(root, 'dist/control-ui/assets');
  // 2026.10 names the chat renderer chunk control-ui-boot-chat-*.js.
  const names = fs.readdirSync(assets).filter(name=>/^chat-page-[\w-]+\.js$/.test(name)
    || (/^control-ui-boot-chat-(?!styles|-)[\w-]+\.js$/.test(name) && fs.readFileSync(path.join(assets,name),'utf8').includes('chat-bubble--with-files')));
  // Legacy bundles still ship chat-page-*.js; 2026.10 only has the boot chunk.
  const only = names.length > 1 && names.some(name => /^control-ui-boot-chat-/u.test(name))
    ? names.filter(name => /^control-ui-boot-chat-/u.test(name))
    : names;
  if(only.length!==1)throw new Error('无法唯一确认聊天页模块：'+names.join(', '));
  const file=path.join(assets,only[0]),original=fs.readFileSync(file,'utf8'),next=transform(original);
  if(next===original)return {changed:false,file:only[0]};
  if(fs.readFileSync(file,'utf8')!==original)throw new Error('聊天页正在更新，未覆盖。');
  const backup=backupRoot||path.join(os.homedir(),'Library/Application Support/SuperPinkie/backups','file-delivery-'+Date.now());
  fs.mkdirSync(backup,{recursive:true,mode:0o700});fs.copyFileSync(file,path.join(backup,only[0]));fs.writeFileSync(file,next);
  refreshPrecompressed(file);
  return {changed:true,file:only[0],backup};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.env.OPENCLAW_ROOT)throw new Error('请明确设置 OpenClaw 包目录。');
  console.log(JSON.stringify(apply(process.env.OPENCLAW_ROOT,{backupRoot:process.env.PINKIE_PATCH_BACKUP_ROOT})));
}
