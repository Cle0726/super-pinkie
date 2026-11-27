// B83：「减少动效」开着时（pinkie.motion.reduce.v1=1 → html[data-pinkie-reduce-motion] + 改写后的 @media），
// 各注入文件的动效要真降级。复发点：laolao-crew.css 等用的是没人设置的 html[data-reduce-motion]，crew 转圈停不下来。
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {waitFirstFrame} from './helpers/browser-first-frame.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'ui/injections');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const own = fs.readdirSync(dir).filter((n) => /\.(css|js)$/.test(n) && !n.startsWith('laolao-vendor'));

const DEAD = /\[data-reduce-motion\]/;
const GUARD = /prefers-reduced-motion|data-pinkie-reduce-motion|data-reduced="true"/;
function problems(name, text) {
  const out = [];
  if (DEAD.test(text)) out.push(`${name}: 用了没人设置的 [data-reduce-motion]`);
  if (name.endsWith('.css') && /\binfinite\b/.test(text) && !GUARD.test(text)) out.push(`${name}: 有 infinite 动画却没有有效降级`);
  return out;
}

test('静态：注入文件里不再出现死属性 [data-reduce-motion]；有 infinite 动画的 CSS 都有有效降级', () => {
  const bad = own.flatMap((f) => problems(f, fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepEqual(bad, []);
});

test('静态反例：把 crew.css 改回旧选择器，扫描会报出来', () => {
  const old = read('ui/injections/laolao-crew.css').replaceAll('data-pinkie-reduce-motion', 'data-reduce-motion');
  const bad = problems('laolao-crew.css', old);
  assert.ok(bad.some((m) => m.includes('[data-reduce-motion]')), bad.join('\n'));
  assert.ok(bad.some((m) => m.includes('infinite')), '旧写法下 crew 没有任何有效降级');
});

test('静态：游戏特效里的 WAAPI 动画在减少动效下不播（CSS 的 animation:none 管不到 .animate()）', () => {
  const fx = read('ui/injections/laolao-game-fx.js');
  assert.match(fx, /reducedMotion = \(\) => \{[^\n]*hasAttribute\('data-pinkie-reduce-motion'\)/, '兜底认属性存在，不认值');
  assert.doesNotMatch(fx, /dataset\.pinkieReduceMotion === '1'/);
  assert.match(fx, /function pulse\(node, delay\) \{\n\s+try \{ if \(settings\(\)\.reduced\) return; node\.animate\(/);
  assert.match(read('ui/injections/laolao-game-exam.js'), /if \(!document\.documentElement\.hasAttribute\('data-pinkie-reduce-motion'\)\) art\.animate\(/);
  assert.match(read('ui/injections/laolao-game-fx.css'), /html\[data-pinkie-reduce-motion\] \.pk-gamefx-layer \*/, 'body 下的特效层也停 CSS 动画');
});

// L84a（#96）：浏览器在 before() 里起，并等它真的画出第一帧（helpers/browser-first-frame.mjs），都在下面 40 s 之外。
// 原来 launch 和第一张冷页面都算在这条测试里：run 46027289535 C.le. 内核 'test timed out after 40000ms'，
// 同一 run portable-checks 19.8 s、windows-checks 2.1 s，而断言本身只读计算样式。等的是「浏览器能画页」，不是调大上限。
let browser = null, why = '';
before(async () => {
  const {playwright} = await import('../tools/study-desk/harness.mjs');
  let lib;
  try { lib = playwright(); } catch { why = 'Playwright is not installed here'; return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { why = 'no browser: ' + error.message.split('\n')[0]; return; }
  await waitFirstFrame(browser, `b83-reduced-motion (${engine})`);
}, {timeout: 120_000});
after(async () => { await browser?.close(); });

test('真浏览器：开减少动效后 crew 转圈、特效层动画停下；关着照常；旧选择器停不下（反例）', {timeout: 40_000}, async (t) => {
  if (!browser) { t.skip(why || 'no browser'); return; }
  const crewCss = read('ui/injections/laolao-crew.css'), fxCss = read('ui/injections/laolao-game-fx.css');
  const pref = read('ui/injections/laolao-motion-preference.js');
  const run = async (reduce, css = crewCss) => {
    const tab = await browser.newPage();
    try {
      const page = '<!doctype html><html><body><div class="pinkie-crew"><div class="pinkie-crew__one pinkie-crew__one--running"><i class="pinkie-crew__arc"></i></div></div><div class="pk-gamefx-layer"><div class="pk-awards"><div class="pk-award"></div></div></div></body></html>';
      await tab.route('http://127.0.0.1:30119/**', (route) => route.fulfill({contentType: 'text/html', body: page}));
      await tab.goto('http://127.0.0.1:30119/chat');
      await tab.evaluate((v) => { v ? localStorage.setItem('pinkie.motion.reduce.v1', '1') : localStorage.removeItem('pinkie.motion.reduce.v1'); }, reduce);
      await tab.addScriptTag({content: pref});
      await tab.addStyleTag({content: css + '\n' + fxCss});
      return await tab.evaluate(() => ({
        attr: document.documentElement.hasAttribute('data-pinkie-reduce-motion'),
        arc: getComputedStyle(document.querySelector('.pinkie-crew__arc')).animationName,
        award: getComputedStyle(document.querySelector('.pk-award')).animationName,
      }));
    } finally { await tab.close(); }
  };
  assert.deepEqual(await run(true), {attr: true, arc: 'none', award: 'none'}, '减少动效：都停');
  const on = await run(false);
  assert.equal(on.attr, false);
  assert.equal(on.arc, 'pinkie-crew-turn', '关着时 crew 照常转');
  assert.notEqual(on.award, 'none', '关着时奖励条照常进场');
  const old = await run(true, crewCss.replaceAll('data-pinkie-reduce-motion', 'data-reduce-motion'));
  assert.equal(old.arc, 'pinkie-crew-turn', '反例：旧选择器下开了减少动效 crew 还在转');
});
