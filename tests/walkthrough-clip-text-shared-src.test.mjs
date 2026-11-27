// #354 uireview 18:03Z：同一个 background-clip:text 来源下有两个以上文字叶子时，
// tools/pr-shots/b11-learning-walkthrough.mjs 的 measure() 给来源记 data-pk-walk-clip-src 是覆盖写，前面叶子的 id 被盖掉；
// 量那片叶子时来源藏不掉，有字 / 藏字两张截图一样，一点墨都量不到（bins 0），却按 ratio 1 报红。
// 这里在真浏览器里跑走查脚本自己的 measure()（从源码里取：脚本一 import 就起浏览器、开服务）和 measureClipText()：
//   ① 同一渐变来源下两个叶子：两个都按像素量到墨（bins ≥ 2、≥ 4.5），issues.text 不报；
//   ② 真量不到墨的 clip-text（白底白字，藏不藏截图都一样）记 skipped:'no-ink'，不按 ratio 1 报红。
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {playwright} from '../tools/study-desk/harness.mjs';
import {measureClipText} from '../tools/pr-shots/clip-text-ink.mjs';

const SRC = fs.readFileSync(new URL('../tools/pr-shots/b11-learning-walkthrough.mjs', import.meta.url), 'utf8');
const from = SRC.indexOf('function measure() {'), to = SRC.indexOf('\nconst installed', from);
const MEASURE = from >= 0 && to > from ? SRC.slice(from, to).trim() : '';

// background 简写会把 background-clip 重置回 border-box，所以样式里 background 要写在 CLIP 前面。
const CLIP = 'display:inline-block;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent';
const html = (inner) => `<!doctype html><html><body style="margin:0;background:#fff;font:760 12px/1.25 system-ui,sans-serif">
<div style="padding:20px">${inner}</div></body></html>`;

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
async function withPage(fn) {
  shared ??= start();
  const b = await shared;
  if (b.why) return b.why;
  const p = await b.newPage({viewport: {width: 300, height: 120}, deviceScaleFactor: 2});
  try { await fn(p); } finally { await p.close(); }
  return '';
}
async function walk(p, inner) {
  await p.setContent(html(inner));
  const row = await p.evaluate(`(${MEASURE})()`);
  await measureClipText(p, row);
  return row;
}
const brief = (row) => JSON.stringify(row.clipText.map(({id, ratio, median, bins, skipped, error}) => ({id, ratio, median, bins, skipped, error})));

test('同一渐变来源下两个文字叶子：两个都按像素量到墨，不误报', async (t) => {
  assert.match(MEASURE, /^function measure\(\) \{[\s\S]*\}$/, '没从走查脚本里取到 measure()');
  const why = await withPage(async (p) => {
    const row = await walk(p, `<span style="background:#605a65;color:#605a65;${CLIP}"><span>关闭</span> <span>中等</span></span>`);
    t.diagnostic(brief(row));
    assert.equal(row.clipText.length, 2, `应标出两个 clip-text 叶子：${brief(row)}`);
    for (const c of row.clipText) {
      assert.ok(c.bins >= 2, `叶子 ${c.id} 没量到墨：${brief(row)}`);
      assert.ok(c.ratio >= 4.5, `叶子 ${c.id} 像素量只有 ${c.ratio}`);
    }
    assert.deepEqual(row.issues.text.filter((i) => i.method === 'pixels'), [], 'clip-text 叶子被误报');
  });
  if (why) t.skip(why);
});

test('真量不到墨的 clip-text：记 skipped no-ink，不按 ratio 1 报红', async (t) => {
  const why = await withPage(async (p) => {
    const row = await walk(p, `<span style="background:#fff;color:#fff;${CLIP}">关闭</span>`);
    t.diagnostic(brief(row));
    assert.equal(row.clipText.length, 1, `应标出一个 clip-text 叶子：${brief(row)}`);
    assert.equal(row.clipText[0].skipped, 'no-ink', `没记 no-ink：${brief(row)}`);
    assert.deepEqual(row.issues.text.filter((i) => i.method === 'pixels'), [], '量不到墨却报了红');
  });
  if (why) t.skip(why);
});
