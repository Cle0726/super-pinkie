/** Bare line breaks and Chinese strong punctuation, preserving HTML escaping. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const marker = '/* pinkie-chat-linebreaks:v2 */';
export function patchSource(source) {
  if (source.includes(marker)) return {changed:false, reason:'already patched'};
  const rule = /\.renderer\.rules\.html_inline=\((\w+),(\w+)\)=>\{let (\w+)=\1\[\2\];return \3\.meta\?\.taskListPlugin===!0\?\3\.content:(\w+)\(\3\.content\)\}/;
  const match = source.match(rule);
  if (!match) return {changed:false,reason:'HTML renderer not found'};
  const setup = source.match(/var (\w+)=new \w+\(\{html:!0,breaks:!0,linkify:!0\}\),[^;]*;/);
  if (!setup) return {changed:false,reason:'Markdown setup not found'};
  const [all,t,i,node,escape] = match;
  const replacement = `.renderer.rules.html_inline=(${t},${i})=>{let ${node}=${t}[${i}];return /^<br\\s*\\/?\\s*>$/i.test(${node}.content)?"<br>":${node}.meta?.taskListPlugin===!0?${node}.content:${escape}(${node}.content)}`;
  let out = source.replace(all,replacement);
  out = out.replace(setup[0], setup[0]+'__pkCjkStrong('+setup[1]+');');
  return {changed:true,out:out+'\n'+marker+'\n'+CJK_RULE};
}
// CommonMark treats punctuation before a closing delimiter followed by a Han
// character as literal. Accept that narrow Chinese prose case in inline text;
// code spans/fences and ordinary emphasis keep the original parser behavior.
const CJK_RULE = String.raw`function __pkCjkStrong(md) {
  md.inline.ruler.before("emphasis", "pk_cjk_strong", (state, silent) => {
    const src = state.src, start = state.pos;
    if (src.slice(start, start+2) !== "**") return false;
    const end = src.indexOf("**", start+2);
    if (end < 0 || end >= state.posMax) return false;
    const text = src.slice(start+2, end);
    if (!text || /[\r\n]/.test(text) || /^\s|\s$/.test(text) || !/\p{Script=Han}/u.test(text)) return false;
    const before = src[start-1] || "", after = src[end+2] || "";
    if (!(/\p{Script=Han}/u.test(before) && /^\p{P}/u.test(text)) && !(/\p{Script=Han}/u.test(after) && /\p{P}$/u.test(text))) return false;
    if (!silent) {
      const open = state.push("strong_open", "strong", 1); open.markup = "**";
      state.md.inline.parse(text, state.md, state.env, state.tokens);
      const close = state.push("strong_close", "strong", -1); close.markup = "**";
    }
    state.pos = end+2; return true;
  });
}
`;

function main() {
  const root=process.env.OPENCLAW_ROOT;
  const assets=root && path.join(root,'dist/control-ui/assets');
  if (!assets || !fs.existsSync(assets)) { console.log('chat-linebreaks: Control UI assets not found; skipped'); return; }
  for (const name of fs.readdirSync(assets).filter(n=>/^markdown-[\w-]+\.js$/.test(n))) {
    const file=path.join(assets,name), result=patchSource(fs.readFileSync(file,'utf8'));
    if (result.changed) { fs.writeFileSync(file,result.out); console.log('chat-linebreaks: patched '+name); }
  }
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main();
