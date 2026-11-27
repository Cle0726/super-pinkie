// 脱敏浮窗（#laolao-desensitize-pop）日夜对比度的量法，给 tests/desensitize-pop-night-real.test.mjs 和
// tools/pr-shots/desensitize-pop-night.mjs 共用。量法同 deep-think-menu-contrast.mjs：颜色按 alpha 叠到下面几层底上，
// 底是渐变时每个色标都算一遍，取最差的那组。字（含 placeholder）对自己所在的底；边框取「对外侧底」「对自己的底」里更差的一个。

export const POP = '#laolao-desensitize-pop';
// 字：≥ 4.5
export const TEXT_PARTS = Object.freeze({
  title: '.ds-head__title > span',
  select: '#ds-model',
  input: '#ds-src',
  placeholder: '#ds-src::placeholder',
  status: '#ds-status',
  run: '#ds-run-label',
  apply: '#ds-apply',
});
// 边框：≥ 3
export const BORDER_PARTS = Object.freeze({
  selectBorder: '#ds-model',
  inputBorder: '#ds-src',
  outputBorder: '#ds-tgt',
  runBorder: '#ds-run',
  applyBorder: '#ds-apply',
});
// 修复前一直不达标、注回旧色必须量出不达标的部分（标题和输入字原本就够，不算进反例）。
export const REVERT_MUST_FAIL = Object.freeze(['placeholder', 'status', 'run', 'apply', 'selectBorder', 'inputBorder', 'outputBorder', 'runBorder', 'applyBorder']);

// 修复前的样式（夜间浮窗原来也是亮底，只是渐变略不同）。直接注到被量的元素上并关掉过渡。
const OLD_POP_BG = {
  day: 'linear-gradient(145deg,rgba(255,252,253,.82),rgba(251,228,241,.68))',
  night: 'linear-gradient(145deg,rgba(255,249,252,.84),rgba(245,218,234,.72))',
};
export function revertCss(theme) {
  const R = `html:not(#_r1):not(#_r2) ${POP}`;
  return [
    `${R}{color:#57364a;background:${OLD_POP_BG[theme]};border-color:rgba(255,255,255,.7);transition:none}`,
    `${R} .ds-head__title,${R} .ds-head__title > span{color:rgba(87,54,74,.78);transition:none}`,
    `${R} .ds-select{border-color:rgba(176,95,131,.18);background:linear-gradient(135deg,rgba(255,255,255,.48),rgba(255,240,248,.4));color:#57364a;transition:none}`,
    `${R} .ds-input{border-color:rgba(176,95,131,.16);background:linear-gradient(145deg,rgba(255,255,255,.42),rgba(255,240,248,.32));color:#57364a;transition:none}`,
    `${R} .ds-input::placeholder{color:rgba(87,54,74,.36)}`,
    `${R} .ds-output{border-color:rgba(202,78,132,.22);background:linear-gradient(145deg,rgba(255,248,252,.52),rgba(251,228,241,.38))}`,
    `${R} .ds-status{color:rgba(87,54,74,.52);transition:none}`,
    `${R} .ds-run{border-color:rgba(255,255,255,.28);background:linear-gradient(135deg,rgba(216,91,145,.82),rgba(202,78,132,.88));transition:none}`,
    `${R} .ds-apply{border-color:rgba(255,255,255,.28);background:linear-gradient(135deg,rgba(98,180,147,.78),rgba(74,162,128,.84));transition:none}`,
  ].join('\n');
}

export function measurePop({pop, text, border}) {
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
  const basesFrom = (from) => {
    const layers = [];
    for (let x = from; x && x.nodeType === 1; x = x.parentElement) {
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
    return bases;
  };
  const worst = (color, bases) => {
    const fg = P(color);
    let w = null;
    for (const b of bases) {
      const r = ratio(over(fg, b), b);
      if (!w || r < w.ratio) w = {ratio: r, bg: `rgb(${[b.r, b.g, b.b].map(Math.round).join(',')})`};
    }
    return {color, ratio: Math.round(w.ratio * 100) / 100, bg: w.bg};
  };
  const root = document.querySelector(pop);
  if (!root) return null;
  const out = {};
  for (const [name, sel] of Object.entries(text)) {
    const [base, pseudo] = sel.split('::');
    const el = root.querySelector(base);
    if (!el) { out[name] = null; continue; }
    const color = pseudo ? getComputedStyle(el, `::${pseudo}`).color : getComputedStyle(el).color;
    out[name] = worst(color, basesFrom(el));
  }
  for (const [name, sel] of Object.entries(border)) {
    const el = root.querySelector(sel);
    if (!el) { out[name] = null; continue; }
    const color = getComputedStyle(el).borderTopColor;
    const outside = worst(color, basesFrom(el.parentElement));
    const inside = worst(color, basesFrom(el));
    out[name] = outside.ratio <= inside.ratio ? {...outside, side: 'outside'} : {...inside, side: 'inside'};
  }
  out.popLuminance = Math.round(Math.max(...basesFrom(root).map(L)) * 1000) / 1000;
  return out;
}

// 离开首页进空会话（脱敏钮只挂在会话输入框上），预置一条改写结果让结果区和「填入」钮显示，再点开浮窗。
export async function openDesensitizePop(page) {
  await page.evaluate(() => {
    localStorage.setItem('laolao:ds-tgt', '这是一段改写后的示例文字。');
    localStorage.removeItem('laolao:ds-src');
    window.__laolaoStartupHome?.leave?.();
  });
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-laolao-startup-home'), null, {timeout: 8_000});
  const btn = page.locator('.laolao-desensitize-btn').first();
  await btn.waitFor({state: 'visible', timeout: 15_000});
  await btn.click({timeout: 10_000});
  await page.waitForFunction((sel) => { const p = document.querySelector(sel); return p && p.querySelector('#ds-apply')?.getBoundingClientRect().height > 0; }, POP, {timeout: 8_000});
  await page.evaluate(() => new Promise((r) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(r)), 260)));
}

export async function revertPopColors(page, theme) {
  await page.addStyleTag({content: revertCss(theme)});
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

// 只留 data-pinkie-night、拿掉原生 data-theme-mode 时浮窗底是不是亮的（同步量完立刻还原，不给观察器反应的机会）。
export function popLightWithNightAttrOnly(pop) {
  const html = document.documentElement;
  const prev = html.getAttribute('data-theme-mode');
  html.removeAttribute('data-theme-mode');
  const bg = getComputedStyle(document.querySelector(pop)).backgroundImage;
  if (prev !== null) html.setAttribute('data-theme-mode', prev);
  const first = (bg.match(/rgba?\([^()]*\)/) || [''])[0];
  const [r, g, b] = (first.match(/[\d.]+/g) || [255, 255, 255]).map(Number);
  return {bg: first, light: (r + g + b) / 3 > 128};
}
