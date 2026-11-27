// 项目模式「工作程度」chip 字与小箭头的真页面对比度量法，给 tests/b11-work-level-chip-day-real.test.mjs 和
// tools/pr-shots/b11-work-level-chip-day.mjs 共用。chip 在输入盒外的第 2 行，底是 .card.chat::after 的雾色和
// ::before 的模糊壁纸，祖先链上读不到，所以按截图像素量：框里出现最多的像素当底，和底对比最高的像素当前景。
import {wkshotBuffer} from './webkit-screenshot.mjs';

export const CHIP_SEL = '.agent-chat__input .pinkie-chip--mode:not(.pinkie-baton)';

// main@4df20e94 的旧色：项目模式默认态 var(--pt-quiet) = --muted-strong #4c7478。注回它就是「改前」。
export const OLD_CHIP_CSS = 'html[data-laolao-mode="project"] .pinkie-chip.pinkie-chip--mode[data-value="default"]:not(.pinkie-baton):not(:hover):not(:focus-visible) { color: var(--pt-quiet) !important; transition: none !important; }';

const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const ratio = (a, b) => { const x = lum(a), y = lum(b); return +((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2); };

export function pixelPair(px) {
  if (!px?.length) return null;
  const count = new Map();
  for (const c of px) { const k = c.join(','); count.set(k, (count.get(k) || 0) + 1); }
  const bg = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
  const fg = px.reduce((best, c) => (ratio(c, bg) > ratio(best, bg) ? c : best), bg);
  return {fg, bg, ratio: ratio(fg, bg)};
}

// 本机 WebKit 的 page.screenshot 会回 0 字节，改用 wkshotBuffer。
export async function shot(page) {
  const engine = page.context().browser()?.browserType().name();
  return engine === 'webkit' ? wkshotBuffer(page, {}) : page.screenshot({animations: 'disabled'});
}

export async function measureChip(page, buf) {
  const got = await page.evaluate(async ({png, sel}) => {
    const chip = [...document.querySelectorAll(sel)].find((n) => n.getClientRects().length);
    if (!chip) return {missing: true, mode: document.documentElement.getAttribute('data-laolao-mode')};
    const el = chip.querySelector(':scope > span');
    const caret = chip.querySelector('.pinkie-chip__caret');
    const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
    const cv = Object.assign(document.createElement('canvas'), {width: img.width, height: img.height});
    const cx = cv.getContext('2d', {willReadFrequently: true}); cx.drawImage(img, 0, 0);
    const scale = img.width / window.innerWidth;
    const grab = (r) => {
      const d = cx.getImageData(Math.floor(r.left * scale), Math.floor(r.top * scale), Math.max(1, Math.ceil(r.width * scale)), Math.max(1, Math.ceil(r.height * scale))).data;
      const px = []; for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]); return px;
    };
    const r = el.getBoundingClientRect();
    return {mode: document.documentElement.getAttribute('data-laolao-mode'), value: chip.dataset.value, text: el.textContent.trim(),
      color: getComputedStyle(el).color, hover: chip.matches(':hover'), focus: chip.matches(':focus-visible'),
      caretOpacity: caret ? getComputedStyle(caret).opacity : null,
      box: [r.left, r.top, r.width, r.height].map(Math.round), glyph: grab(r), caret: caret ? grab(caret.getBoundingClientRect()) : null};
  }, {png: buf.toString('base64'), sel: CHIP_SEL});
  if (got.missing) return got;
  const {glyph, caret, ...rest} = got;
  return {...rest, textPx: pixelPair(glyph), caretPx: pixelPair(caret)};
}
