// B11·T7（#362 走查 T7）：日间思考框的折叠箭头 .pinkie-thinking__chev 原为 #a36b82，在近白卡面上只有 4.21:1；
// 进行中的 shimmer 标签 .pinkie-thinking__label 渐变亮点原为 #e94f91，像素实测最浅处 3.91:1（chat-live-1440-day）。
// 两者都要 >=4.5:1。shimmer 规则与状态胶囊 .pinkie-status__phrase.is-shimmer 共用，胶囊同在近白底上，一并受约束。
// 这里直接从 laolao-process-card.css 取色，把渐变按 sRGB 插值逐点采样，在卡面可能出现的两种近白粉底上取最小对比度；
// 再把 main 的旧色放回同一算法作反例，证明旧色会被判失败。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const css = fs.readFileSync(fileURLToPath(new URL('../ui/injections/laolao-process-card.css', import.meta.url)), 'utf8');

// 卡面 .pinkie-process 是半透明近白渐变：#fff7fb 是它较粉的一端，#fdeef5 再留一档余量给更粉的页面底。
const BACKGROUNDS = ['#ffffff', '#fff7fb', '#fdeef5'];
const MAIN = {chev: '#a36b82', gradient: [['#805269', 35], ['#e94f91', 50], ['#805269', 65]]};

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lum = rgb => rgb.map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

function rule(selector) {
  const at = css.indexOf(selector + ' {');
  assert.ok(at >= 0, `laolao-process-card.css 里找不到 ${selector}`);
  return css.slice(at, css.indexOf('}', at));
}

function gradientStops(body) {
  const m = body.match(/linear-gradient\(90deg,\s*([^;]+)\);/);
  assert.ok(m, 'shimmer 规则里找不到 linear-gradient(90deg, …)');
  return m[1].split(',').map(s => s.trim().match(/^(#[0-9a-f]{6})\s+([\d.]+)%$/i)).map(x => {
    assert.ok(x, 'shimmer 渐变色标应为「#rrggbb N%」');
    return [x[1], +x[2]];
  });
}

// 渐变上每一点（色标之间 sRGB 线性插值）对每种底色的最小对比度。
function worstGradient(stops) {
  let worst = Infinity;
  for (let k = 0; k + 1 < stops.length; k++) {
    const [a, b] = [hex(stops[k][0]), hex(stops[k + 1][0])];
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
      for (const bg of BACKGROUNDS) worst = Math.min(worst, ratio(c, hex(bg)));
    }
  }
  return worst;
}
const worstSolid = color => Math.min(...BACKGROUNDS.map(bg => ratio(hex(color), hex(bg))));

test('T7：日间思考框折叠箭头在近白卡面上 >=4.5:1', () => {
  const m = rule('.pinkie-thinking__chev').match(/(?:^|[;{\s])color:\s*(#[0-9a-f]{6})/i);
  assert.ok(m, '.pinkie-thinking__chev 应有 #rrggbb 字色');
  const got = worstSolid(m[1]);
  assert.ok(got >= 4.5, `.pinkie-thinking__chev ${m[1]} 最低只有 ${got.toFixed(2)}:1`);
});

test('T7：进行中 shimmer 标签（含状态胶囊）渐变最浅处 >=4.5:1', () => {
  const body = rule('.pinkie-thinking.is-live .pinkie-thinking__label, .pinkie-status__phrase.is-shimmer');
  const got = worstGradient(gradientStops(body));
  assert.ok(got >= 4.5, `shimmer 渐变最浅处只有 ${got.toFixed(2)}:1`);
});

test('T7 反例：main 的旧色用同一算法必须判失败', () => {
  assert.ok(worstSolid(MAIN.chev) < 4.5, `旧 chev ${MAIN.chev} 应低于 4.5:1`);
  assert.ok(worstGradient(MAIN.gradient) < 4.5, '旧 shimmer 亮点 #e94f91 应低于 4.5:1');
});
