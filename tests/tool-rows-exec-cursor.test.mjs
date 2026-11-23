// 正在跑的命令：工作过程里那一行左边的圆点变成终端光标（laolao-tool-rows.css）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const css = fs.readFileSync(new URL('../ui/injections/laolao-tool-rows.css', import.meta.url), 'utf8');

test('a running command row shows a blinking block cursor instead of the breathing dot', () => {
  const rule = css.match(/\.cle-run\[data-active\]:is\(\[data-kind="exec"\], \[data-kind="test"\]\) i \{([^}]*)\}/);
  assert.ok(rule, 'running exec / test rows get their own dot rule');
  assert.match(rule[1], /width: 6px; height: 11px;/);
  assert.match(rule[1], /border-radius: 1\.5px;/);
  assert.match(rule[1], /animation: tr-cursor [\d.]+s steps\(1\) infinite;/);
  assert.doesNotMatch(rule[1], /!important/);
  // 和圆点占一样宽：7px + 左右 3px / 2px = 6px + 3.5px / 2.5px，后面的字不挪
  assert.match(rule[1], /margin: 0 2\.5px 0 3\.5px;/);
  assert.match(css, /@keyframes tr-cursor \{[^}]*opacity: \.2;[^}]*\}/);
  // 别的步骤照旧呼吸
  assert.match(css, /\.cle-run\[data-active\] i \{ animation: tr-breathe/);
});

test('reduced motion keeps the cursor still', () => {
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.cle-run i[,)]/);
  assert.match(reduced, /animation: none !important/);
});
