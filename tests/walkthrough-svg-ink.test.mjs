// B11 learning.md:51：走查脚本 measure() 的 svg 取色先读 <svg> 根自己的 fill（默认不透明黑 rgb(0,0,0)），
// 图形画在子元素上（currentColor 填充、circle 只描边、低透明填充 + 描边）时全被量成黑，夜间深底上误报 1.18~1.41。
// 这里在真 Chromium 里跑三份走查脚本自己的 measure()，深底上：
//   ① 浅色 currentColor 填充 / 只描边的 circle / .18 填充 + 描边的徽章 不报；
//   ② 真低对比（深色填充、浅色但 fill-opacity .1）照报；只用 url() 渐变画的跳过。
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {playwright} from '../tools/study-desk/harness.mjs';

const SCRIPTS = ['b11-learning-walkthrough.mjs', 'b11-chat-walkthrough.mjs', 'b11-thinking-walkthrough.mjs'];
const measureOf = (name) => {
  const src = fs.readFileSync(new URL(`../tools/pr-shots/${name}`, import.meta.url), 'utf8');
  const from = src.indexOf('function measure() {'), to = src.indexOf('\n}\n', from);
  return from >= 0 && to > from ? src.slice(from, to + 2) : '';
};

const BG = '#1f1b24';
// measure() 的 add() 按 sel() 去重；每个图标带自己的 class，免得 6 个都成 "div > span > svg" 只剩第一条的 label。
const icon = (label, svg) => `<span class="ico-${label}" aria-label="${label}" style="display:inline-block;margin:6px">${svg}</span>`;
const PAGE = `<!doctype html><html><body style="margin:0;background:${BG};color:#e8e0f0;font:14px system-ui">
<div style="padding:12px">
${icon('nib', '<svg width="18" height="18" viewBox="0 0 16 16" style="color:#e8e0f0"><path d="M2 2h12v12H2z" fill="currentColor"/></svg>')}
${icon('ring', '<svg width="18" height="18" viewBox="0 0 20 20" style="color:#776b88"><circle cx="10" cy="10" r="8" style="fill:none;stroke-width:2.5;stroke:rgba(119,107,136,.22)"/><circle cx="10" cy="10" r="8" style="fill:none;stroke-width:2.5;stroke:#bd73a2"/></svg>')}
${icon('glyph', '<svg width="18" height="18" viewBox="0 0 16 16" style="color:#f0c8dc"><path d="M2 2h12v12H2z" fill="currentColor" fill-opacity=".18" stroke="currentColor" stroke-width="1.3"/></svg>')}
${icon('dark', '<svg width="18" height="18" viewBox="0 0 16 16"><path d="M2 2h12v12H2z" fill="#2a2530"/></svg>')}
${icon('faint', '<svg width="18" height="18" viewBox="0 0 16 16" style="color:#e8e0f0"><path d="M2 2h12v12H2z" fill="currentColor" fill-opacity=".1"/></svg>')}
${icon('grad', '<svg width="18" height="18" viewBox="0 0 16 16"><defs><linearGradient id="g"><stop offset="0" stop-color="#111"/><stop offset="1" stop-color="#222"/></linearGradient></defs><path d="M2 2h12v12H2z" fill="url(#g)"/></svg>')}
</div></body></html>`;

let shared;
after(async () => { const b = await shared; await b?.close?.(); });
async function start() {
  let lib;
  try { lib = playwright(); } catch { return {why: 'Playwright is not installed here'}; }
  for (const options of [{}, {channel: 'chrome'}, {channel: 'msedge'}]) {
    try { return await lib.chromium.launch({headless: true, ...options}); } catch {}
  }
  return {why: 'no Chromium browser here'};
}

for (const name of SCRIPTS) {
  test(`${name}：svg 图标按子图形实际墨色量，不再把根元素默认黑当图标色`, async (t) => {
    const MEASURE = measureOf(name);
    assert.match(MEASURE, /^function measure\(\) \{[\s\S]*\}$/, `没从 ${name} 取到 measure()`);
    shared ??= start();
    const b = await shared;
    if (b.why) return t.skip(b.why);
    const p = await b.newPage({viewport: {width: 400, height: 120}});
    try {
      await p.setContent(PAGE);
      const row = await p.evaluate(`(${MEASURE})()`);
      const icons = row.issues.ui.filter((i) => i.kind === 'icon');
      t.diagnostic(JSON.stringify(icons.map(({label, ratio, fg, bg}) => ({label, ratio, fg, bg}))));
      const got = new Set(icons.map((i) => i.label));
      for (const ok of ['nib', 'ring', 'glyph']) assert.ok(!got.has(ok), `${ok} 在深底上被误报：${JSON.stringify(icons)}`);
      for (const bad of ['dark', 'faint']) assert.ok(got.has(bad), `${bad} 真低对比没报：${JSON.stringify(icons)}`);
      assert.ok(!got.has('grad'), '只用 url() 渐变画的图标应跳过');
    } finally { await p.close(); }
  });
}

// 反例：把 svg 段换回修正前的写法（先读 <svg> 根自己的 stroke/fill），同一页面必须把 nib/ring/glyph 误报成黑色低对比，
// 证明上面的用例真能抓住这个 bug。旧写法内联在这里，不依赖 git 历史（CI 是浅克隆）。
const OLD_SVG = `  for (const svg of document.querySelectorAll('svg')) {
    if (svg.parentElement?.closest('svg')) continue;
    const r = shown(svg); if (!r || r.width < 6 || !onTop(svg, r)) continue;
    const s = getComputedStyle(svg);
    let c = s.stroke && s.stroke !== 'none' ? s.stroke : s.fill;
    if (!c || c === 'none' || P(c).a === 0) {
      const p = svg.querySelector('path,circle,rect,line,polyline,polygon');
      if (p) { const ps = getComputedStyle(p); c = ps.stroke && ps.stroke !== 'none' ? ps.stroke : ps.fill; }
    }
    if (!c || c === 'none' || /^url\\(/.test(c)) continue;
    const {bg, approx} = bgOf(svg.parentElement), fg = over(P(c), bg), k = ratio(fg, bg);
    if (P(c).a === 0) continue;
    if (k < 3) add('ui', sel(svg), {kind: 'icon', sel: sel(svg), label: (svg.closest('[aria-label]')?.getAttribute('aria-label') || '').slice(0, 30), ratio: k, need: 3, fg: hex(fg), bg: hex(bg), approx, ...box(r)});
  }

`;
test('反例：修正前的 svg 取色在同一页面把浅色图标误报成 rgb(0,0,0)', async (t) => {
  const MEASURE = measureOf(SCRIPTS[0]);
  const from = MEASURE.indexOf('  // <svg> 根的 fill'), to = MEASURE.indexOf('  for (const e of document.querySelectorAll(\'input');
  assert.ok(from > 0 && to > from, '没在 measure() 里找到 svg 段');
  const OLD = MEASURE.slice(0, from) + OLD_SVG + MEASURE.slice(to);
  shared ??= start();
  const b = await shared;
  if (b.why) return t.skip(b.why);
  const p = await b.newPage({viewport: {width: 400, height: 120}});
  try {
    await p.setContent(PAGE);
    const row = await p.evaluate(`(${OLD})()`);
    const icons = row.issues.ui.filter((i) => i.kind === 'icon');
    t.diagnostic(JSON.stringify(icons.map(({label, ratio, fg}) => ({label, ratio, fg}))));
    for (const label of ['nib', 'ring', 'glyph']) {
      const hit = icons.find((i) => i.label === label);
      assert.ok(hit && hit.fg === 'rgb(0,0,0)', `旧写法应把 ${label} 量成黑色误报：${JSON.stringify(icons)}`);
    }
  } finally { await p.close(); }
});
