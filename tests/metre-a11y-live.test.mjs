// X1（第七批，11-24）：Metre 下读屏播报。
// 运行状态条的文字 .pk-run__text 是 role=status + aria-live=polite 的播报区。
// Metre 为了不重复显示把它藏起来，但必须用「看不见」的方式（裁成 1px），不能 display:none / visibility:hidden，
// 否则读屏完全听不到「思考中 / 正在读取 / 完成」。原生对话区 .chat-thread 自带 role=log + aria-live，Metre 不能把它摘掉。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const inj = (name) => fs.readFileSync(path.join(root, 'ui', 'injections', name), 'utf8');
const metreFiles = fs.readdirSync(path.join(root, 'ui', 'injections')).filter((f) => /^laolao-metre-.*\.(css|js)$/.test(f));

// 把 CSS 拆成「选择器 { 声明 }」。注释先去掉。
function rules(css) {
  const out = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) out.push({selector: m[1].trim(), body: m[2]});
  return out;
}
const hides = (body) => /display\s*:\s*none|visibility\s*:\s*hidden/i.test(body);

test('运行状态条的播报区在 Metre 下不会被 display:none / visibility:hidden 摘掉', () => {
  const run = inj('laolao-run-status.js');
  assert.match(run, /el\('span', 'pk-run__text'\); text\.setAttribute\('role', 'status'\); text\.setAttribute\('aria-live', 'polite'\)/,
    '前提：.pk-run__text 是 role=status 的播报区');
  const offenders = [];
  for (const file of metreFiles.filter((f) => f.endsWith('.css'))) {
    for (const r of rules(inj(file))) {
      if (!/pk-run__text/.test(r.selector) || !hides(r.body)) continue;
      // 空闲时文字本来就是空的，藏掉没关系；其余语气都要能播报。
      const parts = r.selector.split(/,(?![^(]*\))/).filter((s) => /pk-run__text/.test(s) && !/data-tone="idle"\]/.test(s));
      if (parts.length) offenders.push(`${file}: ${parts.join(', ')}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('Metre 运行中 / 完成 / 等你确认时，文字是「看不见但读屏能读」的裁切写法', () => {
  const css = inj('laolao-metre-skin.css');
  const hit = rules(css).find((r) => /\[data-tone="run"\], \[data-tone="done"\], \[data-tone="ask"\]\) \.pk-run__text$/.test(r.selector));
  assert.ok(hit, '有一条只针对 .pk-run__text 的规则');
  assert.match(hit.body, /position:\s*absolute/);
  assert.match(hit.body, /width:\s*1px/);
  assert.match(hit.body, /height:\s*1px/);
  assert.match(hit.body, /overflow:\s*hidden/);
  assert.match(hit.body, /clip-path:\s*inset\(50%\)/);
  assert.ok(!hides(hit.body));
});

test('Metre 不摘掉原生对话区的 role=log / aria-live', () => {
  for (const file of metreFiles) {
    const text = inj(file);
    assert.doesNotMatch(text, /chat-thread[^\n]{0,120}(removeAttribute\('aria-live'\)|aria-live', 'off'|aria-hidden', 'true')/, file);
  }
});
