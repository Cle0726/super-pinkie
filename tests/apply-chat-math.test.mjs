import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {patchSource, marker} from '../patch/apply-chat-math.mjs';

// patch/apply-chat-math.mjs 的纯逻辑单测：patchSource 的定位与幂等、注入的 markdown-it 规则在真实
// markdown-it 14 上的渲染结果、命令行入口 main() 在临时 OPENCLAW_ROOT 上的行为。
// 不联网、不开浏览器、不碰 ~/.openclaw；main() 只在 mkdtemp 出来的假运行时目录上跑。

const SCRIPT = fileURLToPath(new URL('../patch/apply-chat-math.mjs', import.meta.url));
// 2026.7 的 markdown 分块里真实出现的初始化语句（逗号链里还有第二个声明）
const SETUP_LINE = 'var Z=new oe({html:!0,breaks:!0,linkify:!0}),$e=Z.renderer.rules.code_inline;';

// 仓库已打包的 markdown-it 14（与 chat-linebreaks.test.mjs 同一取法）
function bundledMarkdownIt() {
  const script = fs.readFileSync(new URL('../ui/injections/laolao-markdown-preview.js', import.meta.url), 'utf8');
  const cut = script.indexOf('\nfunction __pkCjkStrong');
  assert.ok(cut > 0, 'preview bundle layout');
  return vm.runInNewContext(script.slice(script.indexOf('\n') + 1, cut) + '\nreturn library;})()', {}).n;
}

const patched = patchSource(SETUP_LINE);
const md = new Function('oe', `${patched.out};return Z`)(bundledMarkdownIt());
const render = (text) => md.render(text);
const span = (tex, display = false) => `<span class="pk-math${display ? ' pk-math--display' : ''}">${tex}</span>`;
const block = (tex) => `<div class="pk-math pk-math--block">${tex}</div>\n`;

test('patchSource 把 __pkMath 调用插在初始化语句之后，运行时追加在文件尾', () => {
  const src = 'head();' + SETUP_LINE + 'Z.enable(`strikethrough`);tail();';
  const result = patchSource(src);
  assert.equal(result.changed, true);
  assert.ok(result.out.startsWith('head();' + SETUP_LINE + '__pkMath(Z);Z.enable(`strikethrough`);tail();\n' + marker + '\n'));
  assert.equal(result.out.split('__pkMath(Z);').length, 2, '只插一次调用');
  for (const name of ['__pkMathEsc', '__pkMathInline', '__pkMathBlock', '__pkMath']) {
    assert.match(result.out, new RegExp(`function ${name}\\(`));
  }
});

test('patchSource 幂等：带标记的源码原样不动', () => {
  assert.deepEqual(patchSource(patched.out), {changed: false, reason: 'already patched'});
  // 只有标记、没有初始化语句也算已打过（判断顺序：先看标记）
  assert.deepEqual(patchSource('x;' + marker), {changed: false, reason: 'already patched'});
});

test('patchSource 找不到 2026.7 形状的初始化就整体跳过', () => {
  for (const src of [
    '',
    'var Z=new oe({html:!0,breaks:!1,linkify:!0}),a=1;', // 选项不同
    'let Z=new oe({html:!0,breaks:!0,linkify:!0}),a=1;', // 不是 var
    'var Z=new oe({html:!0,breaks:!0,linkify:!0});', // 后面没有逗号链
    'var Z=new oe({html:!0,breaks:!0,linkify:!0}),a=1', // 没有分号收尾
    'function vc(){let e=new Fl({html:!0,breaks:!0,linkify:!0});e.use(Zs);return e}', // 2026.10 形状
  ]) {
    assert.deepEqual(patchSource(src), {changed: false, reason: 'markdown-it setup not found'}, src);
  }
});

test('patchSource 只认第一个匹配的初始化语句', () => {
  const src = SETUP_LINE + 'var Y=new oe({html:!0,breaks:!0,linkify:!0}),b=2;';
  const {out} = patchSource(src);
  assert.ok(out.startsWith(SETUP_LINE + '__pkMath(Z);var Y='));
  assert.doesNotMatch(out, /__pkMath\(Y\)/);
});

// 潜在缺口（没修）：SETUP 里的标识符用 \w+，压缩器常用的 `$e` / `$t` 这类带 $ 的名字匹配不上，
// 例如 `var $e=new oe({...}),a=1;` 或 `new $t({...})` 都会被当成「setup not found」静默跳过。
test.todo('SETUP 应该也能认出带 $ 的压缩标识符（如 var $e=new $t({...})）');

test('行内公式：$…$、$$…$$、\\(…\\)、\\[…\\]', () => {
  assert.equal(render('$x^2$'), `<p>${span('x^2')}</p>\n`);
  assert.equal(render('$$a+b$$ 行内'), `<p>${span('a+b', true)} 行内</p>\n`);
  assert.equal(render('\\(a\\) 与 \\[b\\]'), `<p>${span('a')} 与 ${span('b', true)}</p>\n`);
  assert.equal(render('$a$x'), `<p>${span('a')}x</p>\n`, '闭合 $ 后面是字母仍算公式');
  // 段落里跨行的 $$…$$ 走行内规则，原文换行保留
  assert.equal(render('$$\nx\n$$ 尾巴'), `<p>${span('\nx\n', true)} 尾巴</p>\n`);
});

test('价格和不成对的 $ 不当公式', () => {
  for (const text of ['$5 到 $10', '价格 $5', '从$5到$10', '$ a$', '$a $', '$a$1', '$x', '$\n$', '$$\n未闭合']) {
    assert.doesNotMatch(render(text), /pk-math/u, text);
  }
  assert.equal(render('$5 到 $10'), '<p>$5 到 $10</p>\n');
  assert.equal(render('$$\n未闭合'), '<p>$$<br>\n未闭合</p>\n');
});

test('反斜杠与 HTML：公式原文保留，特殊字符转义', () => {
  // 被奇数个反斜杠转义的 $ 不闭合；偶数个反斜杠后的 $ 正常闭合
  assert.equal(render('$a\\$b$'), `<p>${span('a\\$b')}</p>\n`);
  assert.equal(render('$a\\\\$b$'), `<p>${span('a\\\\')}b$</p>\n`);
  // markdown 转义规则不会再吃掉公式里的 \\、\{
  assert.equal(render('$\\{a\\}\\\\b$'), `<p>${span('\\{a\\}\\\\b')}</p>\n`);
  assert.equal(render('$a<b & "c"$'), `<p>${span('a&lt;b &amp; &quot;c&quot;')}</p>\n`);
  assert.doesNotMatch(render('\\$x\\$'), /pk-math/u, '转义的 $ 是普通文字');
  assert.equal(render('`$x$`'), '<p><code>$x$</code></p>\n', '行内代码里不识别');
});

test('块级公式：$$ 与 \\[ 独占行', () => {
  assert.equal(render('$$\na\\\\b\n$$'), block('a\\\\b'));
  assert.equal(render('\\[\nx\n\\]'), block('x'));
  assert.equal(render('$$ a $$'), block('a'), '单行块去掉首尾空白');
  assert.equal(render('$$\nx<y\n$$'), block('x&lt;y'));
  assert.equal(render('$$x$$\n\n段落'), block('x') + '<p>段落</p>\n');
  assert.equal(render('- 列表\n  $$\n  y\n  $$'), `<ul>\n<li>列表${block('y')}</li>\n</ul>\n`);
  assert.equal(render('> $$\n> q\n> $$'), `<blockquote>\n${block('q')}</blockquote>\n`);
  assert.equal(render('    $$a$$'), '<pre><code>$$a$$\n</code></pre>\n', '缩进代码块不动');
});

test('块规则的 token 带行号映射与 markup', () => {
  const tokens = md.parse('前\n\n$$\nx\n$$\n后', {});
  const math = tokens.find((t) => t.type === 'pk_math_block');
  assert.deepEqual([math.map, math.markup, math.content, math.block], [[2, 5], '$$', 'x', true]);
  const inline = md.parseInline('\\[b\\]', {})[0].children[0];
  assert.deepEqual([inline.type, inline.markup, inline.info], ['pk_math', '\\[', 'display']);
});

test('仓库里的 2026.7 运行时快照带着与当前补丁一致的运行时代码', () => {
  const snapshot = fs.readFileSync(new URL('../ui/runtime/markdown-DgASfUKF.js', import.meta.url), 'utf8');
  const runtime = patched.out.slice(patched.out.indexOf(marker));
  assert.ok(snapshot.includes(runtime.trimEnd()), '快照里的运行时与补丁源码漂移了');
  assert.equal(snapshot.split('__pkMath(Z);').length, 2);
  assert.equal(patchSource(snapshot).reason, 'already patched');
});

// ── main()：只在临时 OPENCLAW_ROOT 上跑子进程 ──────────────────────────────

function fakeRoot(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-math-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const assets = path.join(root, 'dist', 'control-ui', 'assets');
  fs.mkdirSync(assets, {recursive: true});
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(assets, name), body);
  return {root, assets, read: (name) => fs.readFileSync(path.join(assets, name), 'utf8')};
}

function runMain(root) {
  const result = spawnSync(process.execPath, [SCRIPT], {env: {...process.env, OPENCLAW_ROOT: root}, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split('\n');
}

test('main 只改匹配的 markdown-*.js，再跑一次报 already patched', (t) => {
  const {root, read} = fakeRoot(t, {
    'markdown-DgASfUKF.js': SETUP_LINE + 'rest();',
    'markdown-other.js': 'var x=1;', // 名字对但没有初始化：静默跳过
    'chat-page-A.js': SETUP_LINE, // 名字不对：不碰
    'markdown-x.js.map': SETUP_LINE, // 扩展名不对：不碰
  });
  assert.deepEqual(runMain(root), ['chat-math: patched markdown-DgASfUKF.js']);
  assert.equal(read('markdown-DgASfUKF.js'), patchSource(SETUP_LINE + 'rest();').out);
  assert.equal(read('markdown-other.js'), 'var x=1;');
  assert.equal(read('chat-page-A.js'), SETUP_LINE);
  assert.equal(read('markdown-x.js.map'), SETUP_LINE);
  const once = read('markdown-DgASfUKF.js');
  assert.deepEqual(runMain(root), ['chat-math: markdown-DgASfUKF.js: already patched', 'chat-math: nothing to patch']);
  assert.equal(read('markdown-DgASfUKF.js'), once);
});

test('main：没有可打的文件、没有 OPENCLAW_ROOT、目录不存在', (t) => {
  const {root} = fakeRoot(t, {'markdown-a.js': 'var x=1;'});
  assert.deepEqual(runMain(root), ['chat-math: nothing to patch']);
  const skipped = ['chat-math: OPENCLAW_ROOT/dist/control-ui/assets not found; skipped'];
  assert.deepEqual(runMain(''), skipped);
  assert.deepEqual(runMain(path.join(root, 'missing')), skipped);
});

test('被别的模块 import 时不执行 main', () => {
  const href = new URL('../patch/apply-chat-math.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(href)})`],
    {env: {...process.env, OPENCLAW_ROOT: ''}, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

// 潜在缺口（没修）：main() 写回 .js 后没有调用 patch/lib-precompressed.mjs 的 refreshPrecompressed，
// 其它改 Control UI 资源的补丁（如 apply-chat-linebreaks.mjs）都会调。运行时带 .br/.gz 孪生文件和
// asset-manifest.json 时（2026.10 起），网关优先发压缩版，改动到不了浏览器。目前 2026.10 上初始化语句本就匹配不上，
// 所以还没有实际后果。
test.todo('main 改写 markdown-*.js 后应刷新 .br/.gz 孪生文件和 asset-manifest.json');
