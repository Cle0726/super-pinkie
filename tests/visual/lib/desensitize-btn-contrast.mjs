// 无限模式输入区「脱敏」触发钮静息态字与图标的真页面对比度量法，给 tests/b11-desensitize-btn-day-real.test.mjs 和
// tools/pr-shots/b11-desensitize-btn-day.mjs 共用。钮在输入盒第 2 行、背景透明，底是雾板和模糊壁纸，
// 祖先链上读不到，所以同 work-level-chip-contrast.mjs 按截图像素量。
import {pixelPair, shot} from './work-level-chip-contrast.mjs';

export const BTN_SEL = '.agent-chat__input .laolao-desensitize-btn';

// 修复前日间静息态：var(--fog-muted) = color-mix(--muted #9c6177 88%, transparent)。
// 直接注到被量的钮上并关掉 color 过渡，注回它就是「改前」。
export const OLD_BTN_COLOR = 'color-mix(in srgb, #9c6177 88%, transparent)';
export const OLD_BTN_CSS = `html:not(#_r1):not(#_r2) ${BTN_SEL}{color:${OLD_BTN_COLOR} !important;transition:none !important}`;

// 首页没有会话输入框上的脱敏钮：离开首页进空会话，等钮可见，鼠标挪开，量的是静息态。
export async function openDesensitizeBtn(page) {
  await page.evaluate(() => window.__laolaoStartupHome?.leave?.());
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-laolao-startup-home'), null, {timeout: 8_000});
  await page.locator(BTN_SEL).first().waitFor({state: 'visible', timeout: 15_000});
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
}

export async function revertBtnColor(page) {
  const tag = await page.addStyleTag({content: OLD_BTN_CSS});
  await page.waitForFunction((sel) => {
    const el = [...document.querySelectorAll(sel)].find((n) => n.getClientRects().length);
    return el && /0\.88\)$/.test(getComputedStyle(el).color) && !el.getAnimations().some((a) => a.transitionProperty === 'color');
  }, BTN_SEL, {timeout: 5_000});
  return tag;
}

export async function measureBtn(page) {
  const buf = await shot(page);
  const got = await page.evaluate(async ({png, sel}) => {
    const btn = [...document.querySelectorAll(sel)].find((n) => n.getClientRects().length);
    if (!btn) return {missing: true, mode: document.documentElement.getAttribute('data-laolao-mode')};
    const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
    const cv = Object.assign(document.createElement('canvas'), {width: img.width, height: img.height});
    const cx = cv.getContext('2d', {willReadFrequently: true}); cx.drawImage(img, 0, 0);
    const scale = img.width / window.innerWidth;
    const grab = (el) => {
      const r = el?.getClientRects().length ? el.getBoundingClientRect() : null;
      if (!r?.width || !r?.height) return null;
      const d = cx.getImageData(Math.floor(r.left * scale), Math.floor(r.top * scale), Math.max(1, Math.ceil(r.width * scale)), Math.max(1, Math.ceil(r.height * scale))).data;
      const px = []; for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]); return px;
    };
    const html = document.documentElement;
    const text = btn.querySelector('.ds-btn-text');
    return {mode: html.getAttribute('data-laolao-mode'), night: html.hasAttribute('data-pinkie-night'), color: getComputedStyle(btn).color,
      hover: btn.matches(':hover'), pressed: btn.getAttribute('aria-pressed') === 'true' || btn.classList.contains('is-active') || btn.classList.contains('is-open'),
      textShown: !!(text?.getClientRects().length && getComputedStyle(text).display !== 'none'),
      glyph: grab(text), icon: grab(btn.querySelector('.ds-btn-icon'))};
  }, {png: buf.toString('base64'), sel: BTN_SEL});
  if (got.missing) return got;
  const {glyph, icon, ...rest} = got;
  return {...rest, textPx: pixelPair(glyph), iconPx: pixelPair(icon)};
}
