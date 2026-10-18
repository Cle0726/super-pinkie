/**
 * Teach the Control UI's markdown-it instance to keep math intact.
 *
 * Plain markdown eats TeX: `\\` becomes `\`, `\{` becomes `{`, `\(` becomes `(`.
 * This adds an inline rule ($…$, $$…$$, \(…\)) that runs before markdown-it's
 * escape rule, and a block rule ($$ … $$ and \[ … \] on their own lines).
 * Matches render as <span|div class="pk-math"> holding the raw TeX as text;
 * laolao-rich.js typesets them with KaTeX. Prices such as "$5 到 $10" are left
 * alone (no space after the opening $, none before the closing $, no digit right
 * after it).
 *
 * The patch is all-or-nothing: a bundle whose markdown-it setup no longer
 * matches is left byte-for-byte untouched.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const marker = '/* pinkie-chat-math:v1 */';
const SETUP = /var (\w+)=new (\w+)\(\{html:!0,breaks:!0,linkify:!0\}\),[^;]*;/;

const RUNTIME = `${marker}
function __pkMathEsc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function __pkMathInline(state,silent){
  const src=state.src,pos=state.pos,max=state.posMax,ch=src.charCodeAt(pos);
  let open,close,start;
  if(ch===36){
    const dbl=src.charCodeAt(pos+1)===36;
    open=dbl?"$$":"$";close=open;start=pos+open.length;
    if(start>=max)return false;
    const c=src.charCodeAt(start);
    if(!dbl&&(c===32||c===9||c===10))return false;
  }else if(ch===92&&(src.charCodeAt(pos+1)===40||src.charCodeAt(pos+1)===91)){
    open=src.slice(pos,pos+2);close=open==="\\\\("?"\\\\)":"\\\\]";start=pos+2;
  }else return false;
  let end=start;
  for(;;){
    end=src.indexOf(close,end);
    if(end===-1||end>=max)return false;
    let k=end-1,bs=0;while(k>=start&&src.charCodeAt(k)===92){bs++;k--}
    if(close==="$"||close==="$$"){if(bs%2===0)break}else break;
    end+=1;
  }
  if(end===start)return false;
  if(close==="$"){
    const pc=src.charCodeAt(end-1),nc=src.charCodeAt(end+1);
    if(pc===32||pc===9||pc===10)return false;
    if(nc>=48&&nc<=57)return false;
  }
  if(!silent){const t=state.push("pk_math","",0);t.content=src.slice(start,end);t.markup=open;t.info=(open==="$$"||open==="\\\\[")?"display":""}
  state.pos=end+close.length;return true;
}
function __pkMathBlock(state,startLine,endLine,silent){
  if(state.sCount[startLine]-state.blkIndent>=4)return false;
  const first=state.src.slice(state.bMarks[startLine]+state.tShift[startLine],state.eMarks[startLine]);
  let open,close;
  if(first.startsWith("$$")){open="$$";close="$$"}else if(first.startsWith("\\\\[")){open="\\\\[";close="\\\\]"}else return false;
  const rest=first.slice(open.length);
  let line=startLine,body=null;
  const i=rest.indexOf(close);
  if(i!==-1){if(rest.slice(i+close.length).trim()!=="")return false;body=rest.slice(0,i)}
  else{
    const parts=[rest];
    for(line=startLine+1;line<endLine;line++){
      const s=state.src.slice(state.bMarks[line]+state.tShift[line],state.eMarks[line]);
      const j=s.indexOf(close);
      if(j!==-1){if(s.slice(j+close.length).trim()!=="")return false;parts.push(s.slice(0,j));body=parts.join("\\n");break}
      parts.push(s);
    }
    if(body===null)return false;
  }
  if(silent)return true;
  state.line=line+1;
  const t=state.push("pk_math_block","",0);t.block=true;t.content=body.trim();t.map=[startLine,state.line];t.markup=open;
  return true;
}
function __pkMath(md){
  md.inline.ruler.before("escape","pk_math",__pkMathInline);
  md.block.ruler.before("fence","pk_math_block",__pkMathBlock,{alt:["paragraph","reference","blockquote","list"]});
  md.renderer.rules.pk_math=(t,i)=>'<span class="pk-math'+(t[i].info?" pk-math--display":"")+'">'+__pkMathEsc(t[i].content)+"</span>";
  md.renderer.rules.pk_math_block=(t,i)=>'<div class="pk-math pk-math--block">'+__pkMathEsc(t[i].content)+"</div>\\n";
}
`;

export function patchSource(src) {
  if (src.includes(marker)) return {changed: false, reason: 'already patched'};
  const m = src.match(SETUP);
  if (!m) return {changed: false, reason: 'markdown-it setup not found'};
  const at = m.index + m[0].length;
  const out = src.slice(0, at) + `__pkMath(${m[1]});` + src.slice(at) + '\n' + RUNTIME;
  return {changed: true, out};
}

function main() {
  const root = process.env.OPENCLAW_ROOT || '';
  const assets = path.join(root, 'dist', 'control-ui', 'assets');
  if (!root || !fs.existsSync(assets)) { console.log('chat-math: OPENCLAW_ROOT/dist/control-ui/assets not found; skipped'); return; }
  const files = fs.readdirSync(assets).filter((f) => /^markdown-[\w-]+\.js$/.test(f));
  let patched = 0;
  for (const f of files) {
    const p = path.join(assets, f);
    const src = fs.readFileSync(p, 'utf8');
    if (!SETUP.test(src) && !src.includes(marker)) continue;
    const r = patchSource(src);
    if (!r.changed) { console.log(`chat-math: ${f}: ${r.reason}`); continue; }
    fs.writeFileSync(p, r.out);
    patched++;
    console.log(`chat-math: patched ${f}`);
  }
  if (!patched) console.log('chat-math: nothing to patch');
}

// Same check as the other patches: a raw path vs a percent-encoded file URL never matches for "超级碧琪".
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
