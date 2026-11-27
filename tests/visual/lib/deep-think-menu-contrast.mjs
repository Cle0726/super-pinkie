// 思考强度菜单内文对比度的量法，给 tests/deep-think-menu-night-real.test.mjs 和 tools/pr-shots/b11-t1-deepthink-night.mjs 共用。
// 每段字的颜色按 alpha 叠到它下面那几层底上；底是渐变时每个色标都算一遍，取最差的那组。

export const MENU_PARTS = Object.freeze({
  head: '.laolao-deep-think-menu__head > span:last-child',
  summary: '.laolao-deep-think-menu__summary',
  hint: '.laolao-deep-think-menu__hint',
  footer: '.laolao-deep-think-menu__footer',
});

// 修复前写死的日间深紫；日间本来就是这四个值，夜间注回它们就是「改前」。
export const OLD_COLORS = Object.freeze({head: 'rgba(87,54,74,.72)', summary: 'rgba(87,54,74,.53)', hint: 'rgba(87,54,74,.62)', footer: 'rgba(87,54,74,.43)'});

export const REVERT_CSS = Object.entries(OLD_COLORS)
  .map(([name, color]) => `html:not(#_r1):not(#_r2) #laolao-deep-think-menu .laolao-deep-think-menu__${name}{color:${color}}`)
  .join('\n');

export function measureMenu(parts) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', {willReadFrequently: true});
  const P = (c) => {
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return {r: d[0], g: d[1], b: d[2], a: d[3] / 255};
  };
  const over = (top, under) => ({r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1});
  const L = ({r, g, b}) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const stops = (img) => (img.match(/(?:rgba?|hsla?|color)\([^()]*\)|#[0-9a-f]{3,8}\b/gi) || []).map(P);
  const night = document.documentElement.hasAttribute('data-pinkie-night');
  const out = {};
  for (const [name, sel] of Object.entries(parts)) {
    const el = document.querySelector(`#laolao-deep-think-menu ${sel}`);
    if (!el) { out[name] = null; continue; }
    const layers = [];
    for (let x = el; x && x.nodeType === 1; x = x.parentElement) {
      const s = getComputedStyle(x);
      const bc = P(s.backgroundColor);
      const cands = s.backgroundImage && s.backgroundImage !== 'none'
        ? stops(s.backgroundImage).map((c) => (bc.a > 0 ? over(c, bc) : c))
        : (bc.a > 0 ? [bc] : []);
      if (!cands.length) continue;
      layers.push(cands);
      if (cands.every((c) => c.a >= 0.999)) break;
    }
    let bases = [P(night ? '#140f17' : '#ffffff')];
    for (const cands of layers.reverse()) bases = bases.flatMap((b) => cands.map((c) => over(c, b)));
    const color = getComputedStyle(el).color;
    const fg = P(color);
    let worst = null;
    for (const b of bases) {
      const r = ratio(over(fg, b), b);
      if (!worst || r < worst.ratio) worst = {ratio: r, bg: `rgb(${[b.r, b.g, b.b].map(Math.round).join(',')})`};
    }
    out[name] = {color, ratio: Math.round(worst.ratio * 100) / 100, bg: worst.bg, layers: layers.length};
  }
  return out;
}

export async function openDeepThinkMenu(page) {
  await page.locator('.laolao-deep-think-btn').first().click({timeout: 10_000});
  await page.waitForFunction(() => { const m = document.querySelector('#laolao-deep-think-menu'); return m && !m.hidden && m.getBoundingClientRect().height > 40; }, null, {timeout: 8_000});
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

export async function revertMenuColors(page) {
  await page.addStyleTag({content: REVERT_CSS});
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#laolao-deep-think-menu .laolao-deep-think-menu__hint')).color === 'rgba(87, 54, 74, 0.62)', null, {timeout: 5_000});
}
