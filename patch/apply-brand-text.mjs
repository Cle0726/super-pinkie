/**
 * 界面上不再出现上游的名字（用户 11-24 07:55：「不要再出现 OpenClaw 了不行吗」）。
 *
 * 只改控制台（dist/control-ui）里用户看得到的文字：品牌位、提示、错误提示、斜杠命令说明、
 * 各语言的界面文字、通知标题。不改技术名字（自定义元素名、配置键、localStorage 键、命令、
 * 文件名），也不改给模型看的内部提示（runtime context / voice 指令），后端会按原文识别它们。
 *
 * 每个文件全有或全无：任何一条原文的出现次数和固定版本（2026.7.1-2）不一样，这个文件就原样不动，
 * 并报出是哪一条。已经带标记的文件跳过，重复运行不叠加。
 *   OPENCLAW_ROOT=<openclaw 包目录> node patch/apply-brand-text.mjs
 * 碧琪共用的 ui/runtime 分块已经用这个脚本烤好（文件开头带标记），安装器不用再跑。
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {refreshPrecompressed} from './lib-precompressed.mjs';

export const marker = '/* pinkie-brand-text:v1 */';
export const NAME = 'C.le.';

// [原文, 改成, 2026.7.1-2 里的出现次数]
const INDEX = [
  ['<span class="sidebar-brand__title">OpenClaw</span>', `<span class="sidebar-brand__title">${NAME}</span>`, 1],
  ['alt="OpenClaw"', `alt="${NAME}"`, 2],
  ['<span class="dashboard-header__breadcrumb-link">OpenClaw</span>', `<span class="dashboard-header__breadcrumb-link">${NAME}</span>`, 1],
  ['aria-label="OpenClaw"', `aria-label="${NAME}"`, 1],
  ['<span class="topbar-brand__title">OpenClaw</span>', `<span class="topbar-brand__title">${NAME}</span>`, 1],
  ['<div class="login-gate__title">OpenClaw</div>', `<div class="login-gate__title">${NAME}</div>`, 1],
  ['`Work on this OpenClaw Workboard card: ${e.title}`', `\`Work on this ${NAME} Workboard card: \${e.title}\``, 1],
  ['Run the update from an OpenClaw checkout', `Run the update from a ${NAME} checkout`, 1],
];
// 面包屑里的链接文字前后是换行和缩进，按结构匹配。
const INDEX_RE = [[/(@click=\$\{this\.handleOverviewClick\}\s*>\s*)OpenClaw(\s*<\/a>)/g, `$1${NAME}$2`, 1]];
const CHAT = [
  ['`Cancelled the active OpenClaw run.`', `\`Cancelled the active ${NAME} run.\``, 1],
  ['`OpenClaw tool call failed`', `\`${NAME} tool call failed\``, 2],
  ['`OpenClaw tool call timed out`', `\`${NAME} tool call timed out\``, 2],
  ['`OpenClaw tool call aborted`', `\`${NAME} tool call aborted\``, 3],
  ['`OpenClaw finished with no text.`', `\`${NAME} finished with no text.\``, 1],
  ['`OpenClaw realtime tool call did not return a run id`', `\`${NAME} realtime tool call did not return a run id\``, 1],
  ['`Show or set OpenClaw MCP servers.`', `\`Show or set ${NAME} MCP servers.\``, 1],
  ['`Restart OpenClaw.`', `\`Restart ${NAME}\``, 1],
  ['e.assistantName||`OpenClaw`', `e.assistantName||\`${NAME}\``, 1],
  ['`Asking OpenClaw...`', `\`Asking ${NAME}...\``, 1],
];
const CONFIG = [['workspace context OpenClaw injects', `workspace context ${NAME} injects`, 1]];
const SERVICE_WORKER = [
  ['// OpenClaw Control – Service Worker', `// ${NAME} Control – Service Worker`, 1],
  ['title: "OpenClaw"', `title: "${NAME}"`, 1],
  ['data.title || "OpenClaw"', `data.title || "${NAME}"`, 1],
];
// 语言包里的「OpenClaw」都是界面文字（移动版配对、Worktrees 说明、升级提示）。
export const LOCALE = /^(?:i18n|ar|de|es|fa|fr|hi|id|it|ja-JP|ko|nl|pl|pt-BR|ru|th|tr|uk|vi|zh-CN|zh-TW)-[A-Za-z0-9_-]{8}\.js$/;

function rulesFor(name) {
  if (/^index-[A-Za-z0-9_-]{8}\.js$/.test(name)) return {pairs: INDEX, patterns: INDEX_RE};
  if (/^chat-page-[A-Za-z0-9_-]{8}\.js$/.test(name)) return {pairs: CHAT, patterns: []};
  if (/^config-page-[A-Za-z0-9_-]{8}\.js$/.test(name)) return {pairs: CONFIG, patterns: []};
  if (name === 'sw.js') return {pairs: SERVICE_WORKER, patterns: []};
  if (LOCALE.test(name)) return {locale: true};
  return null;
}

const occurrences = (text, needle) => text.split(needle).length - 1;
const WORD = /(?<![A-Za-z0-9_$])OpenClaw(?![A-Za-z0-9_$])/g;

/** 改一个文件的文字。返回 {changed, text} 或 {changed:false, reason}。 */
export function transform(name, original) {
  const rules = rulesFor(name);
  if (!rules) return {changed: false, reason: 'not a branded file'};
  if (original.startsWith(marker)) return {changed: false, reason: 'already patched'};
  let text = original;
  if (rules.locale) {
    const total = occurrences(text, 'OpenClaw');
    // 每一处都要是独立的词（后面允许连字符，de / nl 的复合词），否则不碰这个文件。
    const words = [...text.matchAll(WORD)].length;
    if (total === 0) return {changed: false, reason: 'no brand text'};
    if (words !== total) return {changed: false, reason: `${total - words} OpenClaw inside an identifier`};
    text = text.replace(WORD, NAME);
  } else {
    for (const [from, to, count] of rules.pairs) {
      const found = occurrences(text, from);
      if (found !== count) return {changed: false, reason: `expected ${count} × ${from.slice(0, 60)}, found ${found}`};
      text = text.split(from).join(to);
    }
    for (const [pattern, to, count] of rules.patterns) {
      const found = [...text.matchAll(pattern)].length;
      if (found !== count) return {changed: false, reason: `expected ${count} × ${pattern}, found ${found}`};
      text = text.replace(pattern, to);
    }
  }
  return {changed: true, text: marker + text};
}

export function apply(root) {
  const ui = path.join(root, 'dist', 'control-ui');
  if (!fs.existsSync(path.join(ui, 'assets'))) return {changed: [], skipped: ['no dist/control-ui/assets']};
  const files = [path.join(ui, 'sw.js'), ...fs.readdirSync(path.join(ui, 'assets')).map(n => path.join(ui, 'assets', n))]
    .filter(file => fs.existsSync(file) && rulesFor(path.basename(file)));
  const result = {changed: [], skipped: []};
  for (const file of files) {
    const original = fs.readFileSync(file, 'utf8');
    const next = transform(path.basename(file), original);
    if (!next.changed) {
      if (next.reason !== 'already patched' && next.reason !== 'no brand text') result.skipped.push(`${path.basename(file)}: ${next.reason}`);
      continue;
    }
    if (fs.readFileSync(file, 'utf8') !== original) { result.skipped.push(`${path.basename(file)}: changed while patching`); continue; }
    fs.writeFileSync(file, next.text);
    refreshPrecompressed(file);
    result.changed.push(path.basename(file));
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.OPENCLAW_ROOT;
  if (!root) throw new Error('Set OPENCLAW_ROOT to the active OpenClaw package');
  console.log(JSON.stringify(apply(root)));
}
