/** Bare line breaks and Chinese strong punctuation, preserving HTML escaping. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {refreshPrecompressed} from './lib-precompressed.mjs';
export const marker = '/* pinkie-chat-linebreaks:v2 */';
export function patchSource(source) {
  if (source.includes(marker)) return {changed:false, reason:'already patched'};
  // 2026.7 bundle: `renderer.rules.html_inline=(t,i)=>{let node=t[i];return …}`.
  const rule = /\.renderer\.rules\.html_inline=\((\w+),(\w+)\)=>\{let (\w+)=\1\[\2\];return \3\.meta\?\.taskListPlugin===!0\?\3\.content:(\w+)\(\3\.content\)\}/;
  // 2026.10 bundle: the rule is installed through a plugin and looks the token
  // up from the token array (`e.renderer.rules[Hi]=(e,t)=>{let n=e[t];return n?xC(n.content):``}`).
  const current = /(\.renderer\.rules\[[\w$]+\]=)\((\w+),(\w+)\)=>\{let (\w+)=\2\[\3\];return (\4)\?(.+?)\(\4\.content\):\s*``\}(?!\.)/;
  // 2026.7: `var X=new Y({html:!0,breaks:!0,linkify:!0}),…;`
  // 2026.10: `let e=new Y({html:!0,breaks:!0,linkify:!0});` (single declarator, same line).
  const setup = source.match(/var (\w+)=new \w+\(\{html:!0,breaks:!0,linkify:!0\}\),[^;]*;/)
    || source.match(/let (\w+)=new \w+\(\{html:!0,breaks:!0,linkify:!0\}\);/);
  const currentMatch = source.match(current);
  let out;
  if (rule.test(source)) {
    const match = source.match(rule);
    const [all,t,i,node,escape] = match;
    out = source.replace(all, `.renderer.rules.html_inline=(${t},${i})=>{let ${node}=${t}[${i}];return ${node}.meta?.taskListPlugin===!0?${node}.content:__pkLineBreak(${node})||${escape}(${node}.content)}`);
  } else if (currentMatch) {
    // Capture 4 is both the token lookup (`n?…`) and the escaping call name
    // (`xC(n.content)`); they are the same identifier in the bundled rule.
    const [,head,array,index,escape] = currentMatch;
    // Keep the native structural-HTML / inline-code escaping path untouched and
    // only swap a standalone `<br>` token for a real line break.
    out = source.replace(current,
      `${head}(${array},${index})=>{let ${escape}=${array}[${index}];return ${escape}?__pkLineBreak(${escape})?'<br>':${escape}(${escape}.content):\`\`}`);
  } else return {changed:false,reason:'HTML renderer not found'};
  if (!setup) return {changed:false,reason:'Markdown setup not found'};
  out = out.replace(setup[0], setup[0]+'__pkCjkStrong('+setup[1]+');');
  return {changed:true,out:out+'\n'+marker+'\n'+CJK_RULE};
}
// CommonMark treats punctuation before a closing delimiter followed by a Han
// character as literal. Accept that narrow Chinese prose case in inline text;
// code spans/fences and ordinary emphasis keep the original parser behavior.
const CJK_RULE = String.raw`function __pkLineBreak(node) {
  return Boolean(node && node.type === "html_inline" && /^<br\s*\/?\s*>$/i.test(String(node.content || "")));
}
function __pkCjkStrong(md) {
  if (!md || !md.inline || md.inline.__pkCjkStrong) return;
  md.inline.__pkCjkStrong = true;
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
  // 2026.10 keeps the markdown pipeline in the shared Control UI chunk; older
  // bundles had a dedicated markdown-*.js chunk.
  const names = fs.readdirSync(assets).filter(n=>/^markdown-[\w-]+\.js$/.test(n) || /^control-ui-boot-[\w-]+\.js$/.test(n));
  for (const name of names) {
    const file=path.join(assets,name), result=patchSource(fs.readFileSync(file,'utf8'));
    if (result.changed) { fs.writeFileSync(file,result.out); refreshPrecompressed(file); console.log('chat-linebreaks: patched '+name); }
    else if (result.reason !== 'already patched' && process.env.PINKIE_PATCH_VERBOSE === '1') console.log('chat-linebreaks: '+name+': '+result.reason+'; unchanged');
  }
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main();
