// 热点第 1 名 ui/injections/laolao-head.fragment.html（56 次修复）的复发锁，HOTSPOTS B7 续。
// 近 60 天的 fix 提交大多只是 M2 以前的手写版本号（现在统一 ?v=@hash，由 tests/asset-hash-stamp.test.mjs M2-1 锁住）。
// 已经有测试锁住、这里不重复的：fav / engine-upstream 顺序（e43eeb4c、f3b21fd1 → metre-fav、metre-engine-upstream-ui）、
// display.css（33ef51d5 → metre-display）、contrast.css（615cca29 → metre-contrast-real 的反例）、
// queue-steer（e1215288 → chat-tool-timeline）、quiet 排在 cle-stage.js 前（metre-quiet）。
// 这里补三处此前没有自动化测试抓的修复：
//   23a2fa6e  composer-dock.js 进共享 head，排在用它的 deep-think.js、run-status.js 前面
//   b8d1a9e9  作者的 C.le. 签名回到共享 head：cle-signature.js、cle-stage.css，签名排在 cle-stage.js 前
//   c092fc4b  Mac / Windows 共用这一份 head：只有一个 native-assets 槽、night.js 第一个、全部是 / 开头的绝对路径、
//             不重复、只收自有的 laolao-* / vendor/ 脚本和样式、每个入口都带 ?v=@hash
// 只读文本 + node:vm 跑脚本，不启浏览器、不联网、不改产品代码。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const inj = (f) => fileURLToPath(new URL('../ui/injections/' + f, import.meta.url));
const read = (f) => fs.readFileSync(inj(f), 'utf8');
const head = read('laolao-head.fragment.html').replace(/\r\n/g, '\n');
const SLOT = '<!-- pinkie-native-assets -->';

// 和 tools/ui-parity/bundle.py 的 TAG / REF 是同一套规则：打包时就是这样从 head 里取入口的。
const TAG = /<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>\s*<\/script>|<link\b[^>]*>/gi;
const REF = /\b(?:src|href)=["']([^"']+)["']/i;
const entries = [...head.matchAll(TAG)].map((m) => {
  const ref = REF.exec(m[0])?.[1] ?? '';
  return {tag: m[0], ref, at: m.index, path: ref.split('?')[0].replace(/^\.?\//, '')};
});
const at = (file) => {
  const hits = entries.filter((e) => e.path === file);
  assert.equal(hits.length, 1, `${file} 在 head 里应当正好一行，现在 ${hits.length} 行`);
  return hits[0].at;
};

/* ── 23a2fa6e 输入框上方的共享槽位 ─────────────────────────────────────── */

test('23a2fa6e：composer-dock.js 在共享 head 里，排在 deep-think.js 和 run-status.js 前面', () => {
  assert.ok(head.includes('<script defer src="/laolao-composer-dock.js?v=@hash"></script>\n'), 'composer-dock.js 要以 defer 脚本进 head');
  const dock = at('laolao-composer-dock.js');
  for (const user of ['laolao-deep-think.js', 'laolao-run-status.js']) {
    // 两个使用者都是「有 dock 才交给 dock 排位」，head 里少了它就退回各自定位、又叠在一起
    assert.match(read(user), /window\.__pinkieComposerDock/, `${user} 是 dock 的使用者`);
    assert.ok(dock < at(user), `${user} 必须排在 composer-dock.js 后面`);
  }
});

test('23a2fa6e：composer-dock.js 在最小假 DOM 里注册 track / schedule，重复加载不重复挂监听', () => {
  const listeners = [];
  const frames = [];
  const window = {addEventListener: (type) => listeners.push(type)};
  const context = vm.createContext({
    window, innerWidth: 800, innerHeight: 600,
    document: {documentElement: {getAttribute: () => null}, querySelector: () => null},
    requestAnimationFrame: (fn) => frames.push(fn), cancelAnimationFrame: () => {},
  });
  const code = read('laolao-composer-dock.js');
  vm.runInContext(code, context);
  const dock = window.__pinkieComposerDock;
  assert.equal(typeof dock?.track, 'function');
  assert.equal(typeof dock?.schedule, 'function');
  assert.deepEqual([...listeners].sort(), ['laolao:modechange', 'pinkie:session-selected', 'resize']);
  const bar = {hidden: false, dataset: {}, isConnected: false, classList: {contains: () => false}, querySelectorAll: () => []};
  dock.track('run', bar);
  dock.track('run', bar);            // 什么都没变，不再排第二帧
  assert.equal(frames.length, 1);
  frames.shift()();                  // 页面上还没有输入框：安静退出，不抛错
  vm.runInContext(code, context);    // 第二次加载走守卫，不换对象、不多挂监听
  assert.equal(window.__pinkieComposerDock, dock);
  assert.equal(listeners.length, 3);
});

/* ── b8d1a9e9 作者的 C.le. 签名 ───────────────────────────────────────── */

test('b8d1a9e9：C.le. 签名的脚本和样式在共享 head 里，签名先于 cle-stage.js', () => {
  assert.ok(head.includes('<link rel="stylesheet" href="/laolao-cle-stage.css?v=@hash">\n'), 'cle-stage.css 要在 head 里');
  assert.ok(head.includes('<script defer src="/laolao-cle-signature.js?v=@hash"></script>\n'), 'cle-signature.js 要以 defer 脚本进 head');
  assert.ok(head.includes('<script type="module" src="/laolao-cle-stage.js?v=@hash"></script>\n'), 'cle-stage.js 仍是 module 脚本');
  // defer 脚本和 module 脚本按文档顺序执行；cle-stage.js 画过程卡上的静态签名小标时读 window.CleSignature
  assert.match(read('laolao-cle-stage.js'), /window\.CleSignature/);
  assert.ok(at('laolao-cle-signature.js') < at('laolao-cle-stage.js'), 'cle-signature.js 必须排在 cle-stage.js 前面');
  const context = {window: {}};
  vm.runInNewContext(read('laolao-cle-signature.js'), context);
  assert.equal(typeof context.window.CleSignature?.outline, 'function', '签名脚本自己能挂出 CleSignature');
});

/* ── c092fc4b Mac / Windows 共用一份 head ─────────────────────────────── */

test('c092fc4b：共用的这一份 head 守住打包入口的规矩', () => {
  assert.equal(head.split(SLOT).length - 1, 1, '只能有一个 native-assets 槽');
  const slotAt = head.indexOf(SLOT);
  assert.ok(entries.some((e) => e.at < slotAt) && entries.some((e) => e.at > slotAt), '槽前、槽后都要有入口');
  assert.equal(entries[0].path, 'laolao-night.js', 'night.js 必须是第一个入口（先于上游的主题引导）');
  const seen = new Set();
  for (const {tag, ref, path} of entries) {
    assert.ok(ref.startsWith('/') && !ref.startsWith('//'), `必须是 / 开头的绝对路径：${tag}`);
    assert.match(path, /^(?:laolao-[\w.-]+|vendor\/[\w./-]+)\.(?:js|css)$/, `只收自有的脚本和样式：${tag}`);
    assert.ok(!seen.has(path), `重复的资源：${path}`);
    seen.add(path);
    assert.match(ref, /\?v=@hash$/, `每个入口都带 ?v=@hash：${tag}`);
    assert.ok(fs.existsSync(inj(path)), `文件不存在：${path}`);
  }
  // 每个 <script> / <link> 都要能被上面的规则取到，不能有打包时被漏掉的写法
  assert.equal(entries.length, (head.match(/<(?:script|link)\b/gi) || []).length);
});
