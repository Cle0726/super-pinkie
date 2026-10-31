// Reuse the Markdown parser and sanitizer already shipped in this App. No CDN
// and no new runtime dependency. The two existing ESM factories become an IIFE.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {patchSource} from '../../patch/apply-chat-linebreaks.mjs';
const repo=fileURLToPath(new URL('../../',import.meta.url));
const assets=path.join(process.env.PINKIE_CONTROL_UI_ROOT || '/Applications/超級碧琪.app/Contents/Resources/SuperPinkie/runtime/openclaw/dist/control-ui','assets');
const file=fs.readdirSync(assets).find(name=>/^markdown-runtime-[\w-]+\.js$/.test(name));
const runtime=fs.readFileSync(path.join(assets,file),'utf8');
const imported=/^import\{([^}]+)\}from"\.\/([^"/]+)";/u.exec(runtime);if(!imported)throw Error('Unknown Markdown runtime import');
function factory(source,header=''){
 const match=/export\{([^}]+)\};/u.exec(source);if(!match||source.match(/export\{/gu).length!==1)throw Error('Unknown bundled exports');
 const pairs=match[1].split(',').map(pair=>{const m=/^([\w$]+) as ([\w$]+)$/u.exec(pair);if(!m)throw Error('Unknown export '+pair);return m[2]+':'+m[1];});
 return '(()=>{'+header+source.replace(match[0],'')+'\nreturn {'+pairs.join(',')+'};})()';
}
const rolldown=fs.readFileSync(path.join(assets,imported[2]),'utf8');
const bindings=imported[1].split(',').map(pair=>{const m=/^([\w$]+) as ([\w$]+)$/u.exec(pair);if(!m)throw Error('Unknown binding');return m[1]+':'+m[2];});
const stub='var md=new MD({html:!0,breaks:!0,linkify:!0}),same=md;md.renderer.rules.html_inline=(e,t)=>{let n=e[t];return n.meta?.taskListPlugin===!0?n.content:escape(n.content)};';
const patched=patchSource(stub);if(!patched.changed)throw Error(patched.reason);
const helper=patched.out.slice(patched.out.indexOf('function __pkCjkStrong'));
const script=`// Built from ${file}, SHA-256 ${createHash('sha256').update(runtime).digest('hex')}.\n(()=>{'use strict';const roles=${factory(rolldown)};const library=${factory(runtime.slice(imported[0].length),'const {'+bindings.join(',')+'}=roles;')};
${helper}
const md=new library.n({html:false,breaks:true,linkify:true});__pkCjkStrong(md);md.use(library.t(),{enabled:false});
md.renderer.rules.image=(tokens,index)=>{const token=tokens[index],src=token.attrGet('src')||'',alt=md.utils.escapeHtml(token.content||'图片');return /^(?:clekk-material:|data:image\\/(?:png|jpe?g|gif|webp);base64,)/i.test(src)?'<img src="'+md.utils.escapeHtml(src)+'" alt="'+alt+'">':alt;};
function render(text){return library.v.sanitize(md.render(String(text)),{ALLOWED_TAGS:['a','p','br','strong','em','s','h1','h2','h3','h4','h5','h6','blockquote','ul','ol','li','hr','table','thead','tbody','tr','th','td','pre','code','img','input'],ALLOWED_ATTR:['href','title','src','alt','start','type','checked','disabled','class']});}
window.__pinkieMarkdownPreview={render};const source=document.getElementById('pinkie-markdown-source'),target=document.getElementById('pinkie-markdown-document');
if(source&&target){try{target.innerHTML=render(source.textContent);for(const table of target.querySelectorAll('table')){const wrap=document.createElement('div');wrap.className='markdown-table';table.before(wrap);wrap.append(table);}for(const link of target.querySelectorAll('a')){link.rel='noopener noreferrer';}target.dataset.rendered='markdown';}catch(error){console.warn('Markdown preview unavailable',error);target.textContent=source.textContent;target.classList.add('markdown-plain');}}
})();\n`;
const output=process.env.PINKIE_MARKDOWN_OUTPUT || path.join(repo,'ui/injections/laolao-markdown-preview.js');
fs.writeFileSync(output,script);console.log(JSON.stringify({output,bytes:Buffer.byteLength(script),parser:file}));
