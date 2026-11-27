// 真页面「从这里分出去」键压正文的量法（fork-btn-no-overlap，macdev5）：测试与 pr-shots 共用。
// overText：键的矩形与所在组 .chat-text 叶子元素矩形交叠面积之和（与 tools/pr-shots/m6-checkpoint.mjs 同一量法）。
import {FROZEN_TIME_MS, openRealScenePage} from './real-harness.mjs';
import {wkshotBuffer} from './webkit-screenshot.mjs';

export const FOOTER_KEY = '.chat-group.assistant .chat-group-footer .pinkie-fork-action';
export const SCENES = ['short-answers', 'long-conversation'];

// short-answers：long-conversation 页面换成一行短回答（m6-checkpoint 量出 forkOverlapText=2236 的那种历史）。
const t = (text) => [{type: 'text', text}];
const T0 = FROZEN_TIME_MS - 900_000;
const SHORT = [
  {role: 'user', content: t('把 README 的启动命令改成 npm run dev。'), timestamp: T0, __openclaw: {id: 'fk-u1'}},
  {role: 'assistant', stopReason: 'stop', content: t('改好了：README.md 的启动命令现在是 `npm run dev`。'), timestamp: T0 + 60_000, __openclaw: {id: 'fk-a1'}},
  {role: 'user', content: t('端口呢？'), timestamp: T0 + 120_000, __openclaw: {id: 'fk-u2'}},
  {role: 'assistant', stopReason: 'stop', content: t('已改成 5174。'), timestamp: T0 + 180_000, __openclaw: {id: 'fk-a2'}},
];
const SHORT_INIT = new Function(`window.__fakeSeedHistory = ${JSON.stringify(SHORT)};`);

export async function openScene(browser, origin, scene, theme, width) {
  const opts = scene === 'short-answers' ? {initScript: SHORT_INIT} : {};
  const opened = await openRealScenePage(browser, origin, 'long-conversation', theme, opts);
  await opened.page.setViewportSize({width, height: 900});
  await opened.page.waitForSelector(FOOTER_KEY, {state: 'attached', timeout: 10_000});
  return opened;
}

// asMain=true：把键临时塞回它对应的气泡（main 的挂法，样式走 .chat-bubble > .pinkie-fork-action 的绝对定位），同步量完再放回，作反例。
// page.evaluate 只传一个参数：measureKey({index, asMain})。
export function measureKey({index, asMain = false}) {
  const key = document.querySelectorAll('.chat-group.assistant .chat-group-footer .pinkie-fork-action')[index];
  const group = key.closest('.chat-group');
  const home = key.parentElement, next = key.nextSibling;
  const bubble = group.querySelector(`.chat-bubble[data-message-id="${CSS.escape(key.dataset.messageId || '')}"]`);
  if (asMain) bubble.append(key);
  const q = key.getBoundingClientRect();
  const overText = [...group.querySelectorAll('.chat-text')].flatMap((t) => [...t.querySelectorAll('*'), t]).reduce((sum, el) => {
    if (el.children.length) return sum;
    const r = el.getBoundingClientRect();
    return sum + Math.max(0, Math.min(q.bottom, r.bottom) - Math.max(q.top, r.top)) * Math.max(0, Math.min(q.right, r.right) - Math.max(q.left, r.left));
  }, 0);
  const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
  const out = {messageId: key.dataset.messageId, bubbleFound: Boolean(bubble), box: [q.left, q.top, q.width, q.height].map(Math.round),
    opacity: getComputedStyle(key).opacity, pointer: getComputedStyle(key).pointerEvents, clickable: hit === key || key.contains(hit), overText: Math.round(overText)};
  if (asMain) home.insertBefore(key, next);
  return out;
}

// 不用 locator.hover()：它的可操作性等待默认不限时，WebKit 下等不到「稳定 / 收得到事件」就一直挂到测试 300s 超时。
// 聊天区会异步把 .chat-thread 贴底（悬停诊断：WebKit 开页 scrollTop 3→375；Chromium 滚上去后又被拉回 376），
// 先算点再移鼠标就会落到别组（最上面那组 #0 贴底后只露页脚，:hover 丢、键 op=0）。所以：
//   ① 等 .chat-thread scrollTop 连续 500ms 不变；② 悬停点取本组在视口内露出的部分（避开键、elementFromPoint 命中本组），本组看不见才滚 .chat-thread；
//   ③ 移鼠标后在页内确认本组 :hover，不成立就重来，最多 5 次，失败报命中元素与 scrollTop。可点性另由 measureKey 的 elementFromPoint 断言。
async function settleThread(page) {
  await page.waitForFunction(() => {
    const th = document.querySelector('.chat-thread');
    const st = th ? Math.round(th.scrollTop) : 0;
    const w = window.__pkFkSettle || (window.__pkFkSettle = {st, n: 0});
    if (w.st === st) w.n += 1; else { w.st = st; w.n = 0; }
    if (w.n >= 10) { delete window.__pkFkSettle; return true; }
    return false;
  }, null, {polling: 50, timeout: 10_000});
}

function pickHoverPoint({index, sel}) {
  const key = document.querySelectorAll(sel)[index];
  const group = key.closest('.chat-group');
  const thread = document.querySelector('.chat-thread');
  const view = () => {
    const t = thread ? thread.getBoundingClientRect() : {top: 0, bottom: innerHeight, left: 0, right: innerWidth};
    return {top: Math.max(t.top, 0), bottom: Math.min(t.bottom, innerHeight), left: Math.max(t.left, 0), right: Math.min(t.right, innerWidth)};
  };
  const d = (el) => el ? `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''}` : 'null';
  const v = view(), g = group.getBoundingClientRect(), k = key.getBoundingClientRect();
  const top = Math.max(g.top, v.top) + 2, bottom = Math.min(g.bottom, v.bottom) - 2;
  const left = Math.max(g.left, v.left) + 2, right = Math.min(g.right, v.right) - 2;
  const st = thread ? Math.round(thread.scrollTop) : null;
  if (bottom > top && right > left) {
    for (let y = (top + bottom) / 2, step = 0; step < 200; step += 1) {
      // 从可见部分中线向上下交替扫，每行试几个横向位置。
      const off = Math.ceil(step / 2) * 6 * (step % 2 ? -1 : 1);
      const yy = y + off;
      if (yy < top || yy > bottom) { if (Math.ceil(step / 2) * 6 > (bottom - top)) break; continue; }
      for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        const xx = left + (right - left) * f;
        if (xx >= k.left - 2 && xx <= k.right + 2 && yy >= k.top - 2 && yy <= k.bottom + 2) continue;
        const hit = document.elementFromPoint(xx, yy);
        if (hit && group.contains(hit) && !key.contains(hit)) return {ok: true, x: xx, y: yy, hit: d(hit), st};
      }
    }
  }
  // 本组没露出可悬停的部分：把键滚到 .chat-thread 中间，交给下一轮（先等稳定）重挑。
  if (thread) thread.scrollTop += k.top + k.height / 2 - (v.top + v.bottom) / 2;
  return {ok: false, scrolledFrom: st, scrolledTo: thread ? Math.round(thread.scrollTop) : null, groupBox: [g.left, g.top, g.width, g.height].map(Math.round)};
}

function hoverState({index, sel, x, y}) {
  const key = document.querySelectorAll(sel)[index];
  const group = key.closest('.chat-group');
  const thread = document.querySelector('.chat-thread');
  const hit = document.elementFromPoint(x, y);
  const d = (el) => el ? `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''}` : 'null';
  return {groupHover: group.matches(':hover'), hitNow: d(hit), st: thread ? Math.round(thread.scrollTop) : null};
}

export async function hoverKeyGroup(page, index) {
  let last = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await settleThread(page);
    const p = await page.evaluate(pickHoverPoint, {index, sel: FOOTER_KEY});
    if (!p.ok) { last = {attempt, ...p}; continue; }
    await page.mouse.move(p.x - 1, p.y);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(250);
    const s = await page.evaluate(hoverState, {index, sel: FOOTER_KEY, x: p.x, y: p.y});
    if (s.groupHover) return {...p, attempt};
    last = {attempt, x: Math.round(p.x), y: Math.round(p.y), hitAtPick: p.hit, stAtPick: p.st, ...s};
  }
  throw new Error(`hoverKeyGroup #${index}：5 次都没让本组进入 :hover：${JSON.stringify(last)}`);
}

// 页脚键文字对比度（B11 小字门槛 4.5）：键背景透明，底是页脚 / 气泡，按截图像素量——框里最多的像素当底，和底对比最高的当前景。
// OLD_KEY_CSS 把 #477 初版的 62% 稀释直接注到被量的键上并关掉过渡，注回它就是「改前」（日间实绘 2.71–2.81）。
export const OLD_KEY_CSS = `html:not(#_r1):not(#_r2) ${FOOTER_KEY}{color:color-mix(in srgb,currentColor 62%,transparent) !important;transition:none !important}`;
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return +((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2); };
function pixelPair(px) {
  if (!px?.length) return null;
  const count = new Map();
  for (const c of px) { const k = c.join(','); count.set(k, (count.get(k) || 0) + 1); }
  const bg = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
  const fg = px.reduce((best, c) => (ratio(c, bg) > ratio(best, bg) ? c : best), bg);
  return {fg, bg, ratio: ratio(fg, bg)};
}

// 先 hoverKeyGroup(page, index) 让键 opacity=1 再量。
export async function measureKeyContrast(page, index) {
  const engine = page.context().browser()?.browserType().name();
  const buf = engine === 'webkit' ? await wkshotBuffer(page, {}) : await page.screenshot({animations: 'disabled'});
  const got = await page.evaluate(async ({png, index, sel}) => {
    const key = document.querySelectorAll(sel)[index];
    const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
    const cv = Object.assign(document.createElement('canvas'), {width: img.width, height: img.height});
    const cx = cv.getContext('2d', {willReadFrequently: true}); cx.drawImage(img, 0, 0);
    const scale = img.width / window.innerWidth;
    const r = key.getBoundingClientRect();
    const d = cx.getImageData(Math.floor(r.left * scale), Math.floor(r.top * scale), Math.max(1, Math.ceil(r.width * scale)), Math.max(1, Math.ceil(r.height * scale))).data;
    const px = []; for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);
    return {color: getComputedStyle(key).color, opacity: getComputedStyle(key).opacity, px};
  }, {png: buf.toString('base64'), index, sel: FOOTER_KEY});
  const {px, ...rest} = got;
  return {...rest, textPx: pixelPair(px)};
}

export async function revertKeyColor(page) {
  const tag = await page.addStyleTag({content: OLD_KEY_CSS});
  await page.waitForFunction((sel) => [...document.querySelectorAll(sel)].every((k) => !k.getAnimations().some((a) => a.transitionProperty === 'color')), FOOTER_KEY, {timeout: 5_000});
  return tag;
}
