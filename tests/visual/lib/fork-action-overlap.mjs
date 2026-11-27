// 真页面「从这里分出去」键压正文的量法（fork-btn-no-overlap，macdev5）：测试与 pr-shots 共用。
// overText：键的矩形与所在组 .chat-text 叶子元素矩形交叠面积之和（与 tools/pr-shots/m6-checkpoint.mjs 同一量法）。
import {FROZEN_TIME_MS, openRealScenePage} from './real-harness.mjs';

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

export async function hoverKeyGroup(page, index, {force = false} = {}) {
  const group = page.locator('.chat-group.assistant:has(.chat-group-footer .pinkie-fork-action)').nth(index);
  await group.scrollIntoViewIfNeeded();
  await group.locator('.chat-text').first().hover({force});
  await page.waitForTimeout(250);
}
