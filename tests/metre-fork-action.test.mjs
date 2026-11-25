// 11-24 ui2：悬停助手消息时「从这里分出去」键（laolao-session-cards.css：绝对定位在气泡右上角）盖住第一行正文。
// main 上 1440 / 1024 / 820 × 日夜都有（uireview ui-1124-2035.md 第五节第 3 条）。
// Metre 的修法（不改静止排版，metre-board 真页面基线不变）：
// - 组里最后一条带键气泡：键挪到这一组页脚行的最右端（和原生「删除 / 画布 / 复制」同一行），页脚让出 94px 给它；
//   悬停整组消息区（含页脚）都显示键，鼠标从正文移到键上不会丢。
// - 同组前面的带键气泡：气泡底部多留一行键高，键放在那里。
// - 正在输出、没有键的气泡：什么都不改。其他模式不受影响。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const inj = (name) => fs.readFileSync(path.join(root, 'ui', 'injections', name), 'utf8');
const RULE = /^html\[data-laolao-mode="metre"\][^\n{]*\.chat-group\.assistant > \.chat-group-messages \{ position: relative; \}[^\n]*\n/m;

test('Metre：分叉键挪到页脚行的规则只在 Metre 下生效，不用 !important、不嵌套 :has()、不再用正文浮动占位', () => {
  const css = inj('laolao-metre-skin.css');
  const rule = css.match(RULE);
  assert.ok(rule, '找不到 Metre 下把分叉键挪到页脚行的规则');
  assert.match(rule[0], /:has\(\+ \.chat-group-footer\) > \.pinkie-fork-action \{ top: auto; bottom: 0; right: 0;/);
  assert.match(rule[0], /\.chat-bubble:has\(> \.pinkie-fork-action\) \+ \.chat-group-footer \{ padding-right: 94px; \}/);
  assert.match(rule[0], /\.chat-group\.assistant:not\(\.chat-group--timeline-step\) [^{]*::after \{ content: ""; display: block; height: 30px; \}/, '留键高的 ::after 不能落到工作过程步骤上（会让工作过程块常驻多 30px）');
  assert.match(rule[0], /\.chat-group--timeline-step > [^{]*::after \{ content: ""; display: block; position: absolute;/, '工作过程步骤的悬停桥要绝对定位，不占位');
  assert.doesNotMatch(rule[0], /!important/, '这组规则不需要 !important');
  assert.doesNotMatch(rule[0], /:has\([^)]*:has\(/, ':has() 不能嵌套，浏览器会把整条规则丢掉');
  assert.doesNotMatch(css, /pinkie-fork-action\) > \.chat-text::before/, '正文开头的浮动占位会改静止排版，不能再用');
  assert.doesNotMatch(inj('laolao-session-cards.css'), /chat-group-footer/, '共用的 session-cards.css 不动，其他模式不变');
});

const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
const launch = () => playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});
const LONG = '好。我先派一个声部去改按钮颜色，再让另一个声部检查注册页和登录页是不是用的同一个按钮样式。'.repeat(2);
const BODIES = [
  ['段落', `<p>${LONG}</p><p>第二段。</p>`],
  ['短话', '<p>好。</p>'],
  ['小标题开头', '<h3>小标题</h3><p>正文一行。</p>'],
  ['列表开头', `<ul><li>${LONG}</li><li>第二项</li></ul>`],
  ['代码块', '<pre><code>const x = someFunctionCall(argumentOne, argumentTwo, argumentThree);\nconst y = 2;</code></pre>'],
  ['表格', '<table><tr><th>列一</th><th>列二</th></tr><tr><td>一</td><td>二</td></tr></table>'],
];
const KEY = '<button class="pinkie-session-card__button pinkie-fork-action" type="button">从这里分出去</button>';
// 页脚照真页面：左边时间，右边原生三个 24px 键（删除 / 在画布中打开 / 复制）。
const FOOTER = '<div class="chat-group-footer" style="display:flex;align-items:center;gap:8px;margin-top:8px;min-height:24px"><span class="chat-group-timestamp">19:00</span>'
  + `<div class="chat-group-footer-actions" style="margin-left:auto;display:flex;gap:4px">${'<button type="button" aria-label="原生键" style="width:24px;height:24px;padding:0"></button>'.repeat(3)}</div></div>`;
const bubble = (id, html, key = true, cls = '') => `<div class="chat-bubble${cls}" style="width:fit-content;max-width:100%" data-message-id="${id}"><div class="chat-text">${html}</div>${key ? KEY : ''}</div>`;
const group = (w, inner, attr = '') => `<div class="chat-group assistant"${attr} style="display:flex;margin-bottom:16px"><div class="chat-group-messages" style="width:${w}px">${inner}${FOOTER}</div></div>`;
const page = (mode, night, w) => [
  `<!doctype html><html data-laolao-mode="${mode}"${night ? ' data-pinkie-night="1"' : ''}><head><style>.chat-bubble { position: relative; } .chat-text :where(pre) { overflow: auto; }</style></head>`,
  '<body style="margin:0;font:15px/1.7 sans-serif"><div class="chat-thread">',
  ...BODIES.map(([, html], i) => group(w, bubble(`msg:assistant:${i}:0`, html))),
  // 工作过程块（真页面「碧琪的工作过程」）：步骤气泡后面接工具行，没有页脚。它不能比 main 多占高，否则后面各组都会下移。
  `<div class="chat-group assistant chat-group--process" style="display:flex;margin-bottom:16px"><div class="chat-group-messages" style="width:${w}px"><div class="pinkie-process__rows">`
    + `<div class="chat-group assistant chat-group--timeline-step" style="margin:0 6px"><div class="chat-group-messages">${bubble('msg:assistant:8:0', `<p>${LONG}</p>`)}</div></div>`
    + '<div class="chat-group tool chat-group--timeline-step" style="margin:0 6px"><button type="button" class="cle-run" style="display:flex;width:210px;height:28px;margin:2px 0">读了 1 个文件</button></div>'
    + '</div></div></div>',
  group(w, bubble('msg:assistant:9:0', '<p>正在输出的这条没有键。</p>', false, ' streaming'), ' id="nokey"'),
  // 同组连着两条带键气泡（真机上「文字、工具卡、文字」）：放在最后，它让出的键高不影响上面各组的位置。
  group(w, bubble('msg:assistant:7:0', `<p>${LONG}</p>`) + bubble('msg:assistant:7:1', '<p>工具卡后面接着说的一段。</p>'), ' data-multi="1"'),
  '</div></body></html>',
].join('');

// 静止（鼠标在页面外）时每条气泡里文字行框的位置：单气泡组记绝对位置，多气泡组记相对气泡的位置。
const restRects = (tab) => tab.evaluate(() => {
  const rects = (el, dx = 0, dy = 0) => { const out = []; const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let t = tw.nextNode(); t; t = tw.nextNode()) { if (!t.data.trim()) continue; const g = document.createRange(); g.selectNodeContents(t); for (const a of g.getClientRects()) if (a.width > 1) out.push([a.left - dx, a.top - dy, a.right - dx, a.bottom - dy].map((v) => Math.round(v * 100) / 100).join(',')); } return out; };
  const single = []; const multi = [];
  for (const b of document.querySelectorAll('.chat-bubble')) {
    const text = b.querySelector('.chat-text');
    if (b.closest('[data-multi]')) { const q = b.getBoundingClientRect(); multi.push(...rects(text, q.left, q.top)); } else single.push(...rects(text));
  }
  return {single, multi};
});

// 悬停每条带键气泡的正文，再一步步移到键中心：键压几条字、压几个原生键、是否在组里、途中最低 opacity、终点是不是键。
async function measure(tab) {
  const ids = await tab.evaluate(() => [...document.querySelectorAll('.chat-bubble:has(> .pinkie-fork-action)')].map((b) => b.dataset.messageId));
  const out = {};
  for (const id of ids) {
    const sel = `.chat-bubble[data-message-id="${id}"]`;
    await tab.mouse.move(1, 1);
    const from = await tab.evaluate((s) => { const r = document.querySelector(`${s} .chat-text`).getBoundingClientRect(); return [r.left + 8, r.top + 8]; }, sel);
    await tab.mouse.move(from[0], from[1]);
    const r = await tab.evaluate((s) => {
      const bub = document.querySelector(s); const k = bub.querySelector(':scope > .pinkie-fork-action'); const q = k.getBoundingClientRect();
      const ov = (a) => Math.min(a.right, q.right) - Math.max(a.left, q.left) > 0 && Math.min(a.bottom, q.bottom) - Math.max(a.top, q.top) > 0;
      let hits = 0; const tw = document.createTreeWalker(document.querySelector('.chat-thread'), NodeFilter.SHOW_TEXT);
      for (let t = tw.nextNode(); t; t = tw.nextNode()) { if (!t.data.trim() || t.parentElement.closest('.pinkie-fork-action')) continue; const g = document.createRange(); g.selectNodeContents(t); hits += [...g.getClientRects()].filter((a) => a.width > 1 && ov(a)).length; }
      const grp = bub.closest('.chat-group'); const gq = (bub.closest('.pinkie-process__rows') || grp).getBoundingClientRect();
      const btnHit = [...document.querySelectorAll('.chat-thread button')].filter((e) => !e.matches('.pinkie-fork-action') && ov(e.getBoundingClientRect())).length;
      const last = Boolean(bub.nextElementSibling?.matches('.chat-group-footer'));
      const fq = grp.querySelector('.chat-group-footer')?.getBoundingClientRect();
      return {hits, btnHit, last, inGroup: q.left >= gq.left - 0.5 && q.right <= gq.right + 0.5 && q.top >= gq.top - 0.5 && q.bottom <= gq.bottom + 0.5,
        inFooterRow: Boolean(fq) && q.top >= fq.top - 0.5 && q.bottom <= fq.bottom + 0.5, op: getComputedStyle(k).opacity, to: [(q.left + q.right) / 2, (q.top + q.bottom) / 2]};
    }, sel);
    let minOp = 1;
    for (let s = 1; s <= 10; s += 1) {
      await tab.mouse.move(from[0] + (r.to[0] - from[0]) * s / 10, from[1] + (r.to[1] - from[1]) * s / 10);
      minOp = Math.min(minOp, Number(await tab.evaluate((x) => getComputedStyle(document.querySelector(`${x} > .pinkie-fork-action`)).opacity, sel)));
    }
    const onKey = await tab.evaluate(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('.pinkie-fork-action')), r.to);
    out[id] = {...r, minOp, onKey};
  }
  await tab.mouse.move(1, 1);
  return out;
}

// 三种对话栏宽度：1440 / 1024 / 820 下真页面里组消息区大约这么宽。
const WIDTHS = [752, 560, 400];
for (const night of [false, true]) {
  test(`Metre（真浏览器，${night ? '夜间' : '日间'}）：分叉键在页脚行不压正文、不压原生键、鼠标移过去不丢；静止排版和 main 一致；反例：去掉规则就压 (${engine})`, {timeout: 120_000}, async () => {
    const cards = inj('laolao-session-cards.css'); const skin = inj('laolao-metre-skin.css');
    assert.ok(RULE.test(skin), '找不到页脚行规则');
    const mainSkin = skin.replace(RULE, '');
    const browser = await launch();
    try {
      const tab = await browser.newPage({viewport: {width: 820, height: 2600}});
      const open = async (mode, css, w) => {
        await tab.route('http://127.0.0.1:30119/**', (route) => route.fulfill({contentType: 'text/html; charset=utf-8', body: page(mode, night, w)}));
        await tab.goto('http://127.0.0.1:30119/');
        for (const c of css) await tab.addStyleTag({content: c});
        await tab.unroute('http://127.0.0.1:30119/**');
        await tab.mouse.move(1, 1);
      };
      for (const w of WIDTHS) {
        await open('metre', [cards, mainSkin], w);
        const restMain = await restRects(tab);
        const broken = w === WIDTHS[0] ? await measure(tab) : null;
        await open('metre', [cards, skin], w);
        const restFixed = await restRects(tab);
        assert.deepEqual(restFixed.single, restMain.single, `宽${w}：单气泡组静止时正文排版和 main 不一样（metre-board 基线会变）`);
        assert.deepEqual(restFixed.multi, restMain.multi, `宽${w}：多气泡组里正文相对气泡的排版变了`);
        const fixed = await measure(tab);
        const ids = Object.keys(fixed);
        assert.equal(ids.length, BODIES.length + 3, `宽${w}：带键气泡数不对`);
        for (const id of ids) {
          const m = fixed[id]; const tag = `宽${w} ${id}`;
          assert.equal(m.op, '1', `${tag}：悬停正文时键要显示出来`);
          assert.equal(m.hits, 0, `${tag}：键压到 ${m.hits} 行字`);
          assert.equal(m.btnHit, 0, `${tag}：键压到 ${m.btnHit} 个原生页脚键`);
          assert.ok(m.inGroup, `${tag}：键跑出了自己这一组`);
          assert.equal(m.minOp, 1, `${tag}：鼠标从正文移到键的路上键消失了`);
          assert.ok(m.onKey, `${tag}：鼠标到了键中心却点不到键`);
          if (m.last) assert.ok(m.inFooterRow, `${tag}：组里最后一条的键应该在页脚行里`);
        }
        const nokey = await tab.evaluate(() => { const g = document.getElementById('nokey'); return [getComputedStyle(g.querySelector('.chat-group-footer')).paddingRight, getComputedStyle(g.querySelector('.chat-bubble')).paddingBottom]; });
        assert.deepEqual(nokey, ['0px', '0px'], `宽${w}：没有键的气泡（正在输出）不该让位`);
        // 反例：同一页面去掉这组规则（等同 main），段落、短话、列表开头、工作过程步骤悬停时都会被键压住。
        if (broken) assert.ok(broken['msg:assistant:8:0'].hits > 0, '反例没压字（工作过程步骤）：这条测试抓不住复发');
        if (broken) for (const name of ['段落', '短话', '列表开头']) {
          const i = BODIES.findIndex(([n]) => n === name);
          assert.ok(broken[`msg:assistant:${i}:0`].hits > 0, `反例没压字（${name}）：这条测试抓不住复发`);
        }
      }
      // 其他模式不受影响：换成唠嗑模式，键仍在气泡右上角，组消息区不改定位。
      await open('laolao', [cards, skin], WIDTHS[0]);
      const other = await tab.evaluate(() => [getComputedStyle(document.querySelector('.chat-group-messages')).position, getComputedStyle(document.querySelector('.pinkie-fork-action')).top, getComputedStyle(document.querySelector('.chat-group-footer')).paddingRight]);
      assert.deepEqual(other, ['static', '2px', '0px'], '唠嗑模式下不该出现 Metre 的页脚行规则');
    } finally { await browser.close(); }
  });
}
