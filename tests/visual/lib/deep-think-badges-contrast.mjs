// 档位卡角标与边框对比度的量法，给 tests/deep-think-menu-badges-real.test.mjs 和 tools/pr-shots/b11-t3-deepthink-badges.mjs 共用。
// 角标白字按 alpha 叠到它下面那几层底上；卡边框对面板底和卡底（渐变每个色标都算）取最差的那组。

// 修复前的角标浅底和档位卡白色淡边框；直接注到被量元素上并关掉过渡。
export const OLD_BADGE_CSS = [
  'html:not(#_r1):not(#_r2) #laolao-deep-think-menu .laolao-deep-think-menu__numeral{background:color-mix(in srgb,var(--tier-accent) 82%,white);transition:none}',
  'html:not(#_r1):not(#_r2) #laolao-deep-think-menu .laolao-deep-think-menu__recommended{background:color-mix(in srgb,var(--tier-accent) 76%,white);transition:none}',
  'html:not(#_r1):not(#_r2) #laolao-deep-think-menu .laolao-deep-think-menu__item{border-color:rgba(255,255,255,.28);transition:none}',
].join('\n');

export function measureBadges() {
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
  const own = (x) => {
    const s = getComputedStyle(x);
    const bc = P(s.backgroundColor);
    return s.backgroundImage && s.backgroundImage !== 'none'
      ? stops(s.backgroundImage).map((c) => (bc.a > 0 ? over(c, bc) : c))
      : (bc.a > 0 ? [bc] : []);
  };
  const basesUnder = (el) => {
    const layers = [];
    for (let x = el; x && x.nodeType === 1; x = x.parentElement) {
      const cands = own(x);
      if (!cands.length) continue;
      layers.push(cands);
      if (cands.every((c) => c.a >= 0.999)) break;
    }
    let bases = [P(document.documentElement.hasAttribute('data-pinkie-night') ? '#140f17' : '#ffffff')];
    for (const cands of layers.reverse()) bases = bases.flatMap((b) => cands.map((c) => over(c, b)));
    return bases;
  };
  const worst = (fg, bases) => Math.round(Math.min(...bases.map((b) => ratio(over(fg, b), b))) * 100) / 100;
  const out = {};
  for (const item of document.querySelectorAll('#laolao-deep-think-menu .laolao-deep-think-menu__item')) {
    if (item.classList.contains('is-selected') || item.matches(':hover')) continue;
    const row = {};
    for (const [name, sel] of [['numeral', '.laolao-deep-think-menu__numeral'], ['recommended', '.laolao-deep-think-menu__recommended']]) {
      const el = item.querySelector(sel);
      if (!el) continue;
      const s = getComputedStyle(el);
      row[name] = {ratio: worst(P(s.color), basesUnder(el)), bg: s.backgroundColor};
    }
    const panel = basesUnder(item.parentElement);
    const card = panel.flatMap((b) => own(item).map((c) => over(c, b)));
    const border = getComputedStyle(item).borderTopColor;
    row.border = {ratio: worst(P(border), [...panel, ...card]), color: border};
    out[item.dataset.tier] = row;
  }
  return out;
}

export async function settleTierItems(page) {
  await page.mouse.move(1, 1);
  await page.waitForFunction(() => [...document.querySelectorAll('#laolao-deep-think-menu .laolao-deep-think-menu__item')]
    .every((el) => !el.getAnimations().length), null, {timeout: 5_000});
}

export async function revertBadgeColors(page) {
  await page.addStyleTag({content: OLD_BADGE_CSS});
  await page.waitForFunction(() => [...document.querySelectorAll('#laolao-deep-think-menu .laolao-deep-think-menu__item')]
    .every((el) => getComputedStyle(el).borderTopColor.replace(/\s/g, '') === 'rgba(255,255,255,0.28)'
      && !el.getAnimations().some((a) => /border|background/.test(a.transitionProperty || ''))), null, {timeout: 5_000});
}
