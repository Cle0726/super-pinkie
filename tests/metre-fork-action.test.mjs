// 11-24 ui2：悬停助手消息时「从这里分出去」键（laolao-session-cards.css：绝对定位在气泡右上角）盖住第一行正文。
// main 上 1440 / 1024 / 820 × 日夜都有（uireview ui-1124-2035.md 第五节第 3 条）。Metre 的修法：只在气泡里真有这个键时，
// 正文开头放一个向右浮动、和键一样大的占位，前一两行字绕开键；正在输出、工具卡、子会话没有键，就不占位。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const inj = (name) => fs.readFileSync(path.join(root, 'ui', 'injections', name), 'utf8');
const SPACER = /^html\[data-laolao-mode="metre"\][^\n{]*\.chat-bubble:has\(> \.pinkie-fork-action\) > \.chat-text::before \{[^}]*\}\n/m;

test('Metre：分叉键的占位规则只认「气泡里有键」，只在 Metre 下生效', () => {
  const css = inj('laolao-metre-skin.css');
  const rule = css.match(SPACER);
  assert.ok(rule, '找不到 Metre 下给分叉键让位的规则');
  assert.match(rule[0], /float: right;/);
  assert.doesNotMatch(rule[0], /!important/, '占位规则不需要 !important');
  assert.doesNotMatch(inj('laolao-session-cards.css'), /pinkie-fork-action\)? > \.chat-text::before/, '共用的 session-cards.css 不动，其他模式不变');
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
const page = (mode, night) => [
  `<!doctype html><html data-laolao-mode="${mode}"${night ? ' data-pinkie-night="1"' : ''}><head><style>.chat-text :where(pre) { overflow: auto; }</style></head>`,
  '<body style="margin:0;font:15px/1.7 sans-serif"><div class="chat-thread">',   // 上一行照抄原生 control-ui 的 pre 规则：滚动容器会让开浮动，不从占位下面穿过去
  ...BODIES.map(([, html], i) => `<div class="chat-group assistant" style="display:flex"><div class="chat-group-messages" style="width:752px"><div class="chat-bubble" style="width:fit-content;max-width:100%" data-message-id="msg:assistant:${i}:0"><div class="chat-text">${html}</div><button class="pinkie-session-card__button pinkie-fork-action" type="button">从这里分出去</button></div></div></div>`),
  '<div class="chat-group assistant" style="display:flex"><div class="chat-group-messages" style="width:752px"><div class="chat-bubble streaming" data-message-id="msg:assistant:9:0"><div class="chat-text"><p id="nokey">正在输出的这条没有键。</p></div></div></div></div>',
  '</div></body></html>',
].join('');

// 悬停每条助手消息，数键的矩形压到几条正文行（只量文字节点的行框，不量块元素本身的框）。
async function measure(tab) {
  const out = [];
  for (let i = 0; i < BODIES.length; i++) {
    await tab.hover(`.chat-bubble[data-message-id="msg:assistant:${i}:0"] .chat-text`, {position: {x: 8, y: 8}, force: true});
    out.push(await tab.evaluate((k) => {
      const bub = document.querySelector(`.chat-bubble[data-message-id="msg:assistant:${k}:0"]`);
      const q = bub.querySelector('.pinkie-fork-action').getBoundingClientRect();
      const lines = []; const tw = document.createTreeWalker(bub.querySelector('.chat-text'), NodeFilter.SHOW_TEXT);
      for (let t = tw.nextNode(); t; t = tw.nextNode()) { if (!t.data.trim()) continue; const g = document.createRange(); g.selectNodeContents(t); lines.push(...[...g.getClientRects()].filter((a) => a.width > 1)); }
      const hits = lines.filter((a) => Math.min(a.right, q.right) - Math.max(a.left, q.left) > 0 && Math.min(a.bottom, q.bottom) - Math.max(a.top, q.top) > 0).length;
      const text = bub.querySelector('.chat-text');
      const before = getComputedStyle(text, '::before'); const br = bub.getBoundingClientRect();
      return {hits, room: parseFloat(before.width) || 0, need: Math.ceil(br.right - q.left), opacity: getComputedStyle(bub.querySelector('.pinkie-fork-action')).opacity, overflow: text.scrollWidth - text.clientWidth};
    }, i));
  }
  return out;
}

for (const night of [false, true]) {
  test(`Metre（真浏览器，${night ? '夜间' : '日间'}）：悬停助手消息时分叉键不压正文；反例：去掉占位规则就压 (${engine})`, {timeout: 40_000}, async () => {
    const cards = inj('laolao-session-cards.css'); const skin = inj('laolao-metre-skin.css');
    assert.ok(SPACER.test(skin), '找不到占位规则');
    const browser = await launch();
    try {
      const tab = await browser.newPage({viewport: {width: 820, height: 1400}});
      const open = async (mode, css) => {
        await tab.route('http://127.0.0.1:30119/**', (route) => route.fulfill({contentType: 'text/html; charset=utf-8', body: page(mode, night)}));
        await tab.goto('http://127.0.0.1:30119/');
        for (const c of css) await tab.addStyleTag({content: c});
        await tab.unroute('http://127.0.0.1:30119/**');
      };
      await open('metre', [cards, skin]);
      const fixed = await measure(tab);
      BODIES.forEach(([name], i) => {
        assert.equal(fixed[i].opacity, '1', `${name}：悬停时键要显示出来`);
        assert.equal(fixed[i].hits, 0, `${name}：键压到 ${fixed[i].hits} 行正文`);
        assert.ok(fixed[i].room >= fixed[i].need, `${name}：占位宽 ${fixed[i].room}px 小于键宽加右边距 ${fixed[i].need}px`);
        assert.ok(fixed[i].overflow <= 0, `${name}：让位后正文横向溢出 ${fixed[i].overflow}px`);
      });
      assert.equal(await tab.evaluate(() => getComputedStyle(document.querySelector('.chat-bubble.streaming .chat-text'), '::before').content), 'none', '没有键的气泡（正在输出）不占位');
      // 反例：同一页面去掉占位规则（等同 main 15ee1065），段落、短话、列表开头都会被键压住（气泡按内容收窄，和真页面一样）。
      await open('metre', [cards, skin.replace(SPACER, '')]);
      const broken = await measure(tab);
      for (const name of ['段落', '短话', '列表开头']) {
        const i = BODIES.findIndex(([n]) => n === name);
        assert.ok(broken[i].hits > 0, `反例没压字（${name}）：这条测试抓不住复发`);
      }
      // 其他模式不受影响：同一页面换成唠嗑模式，正文开头不占位。
      await open('laolao', [cards, skin]);
      assert.equal(await tab.evaluate(() => getComputedStyle(document.querySelector('.chat-bubble .chat-text'), '::before').content), 'none', '唠嗑模式下不该出现 Metre 的占位');
    } finally { await browser.close(); }
  });
}
