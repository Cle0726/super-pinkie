// The empty room: an arched window holding the room's painting, the room's name and one line
// in its voice, and a few things worth asking here. Replaces the stock avatar and suggestions.
import {ROOMS} from './rooms.js';

const ART = '/cle/static/art/rooms/';
const SUGGEST = {
  chat: ['今天过得怎么样？', '陪我想想周末去哪', '给我讲个冷知识'],
  project: ['看看这个项目现在的状态', '帮我把这件事拆成三步', '跑一遍测试，找出最先坏的地方'],
  thinking: ['陪我把一个模糊的念头想清楚', '这件事有哪些我没想到的角度？', '帮我给这个点子挑毛病'],
  learning: ['开始今天的功课', '复习今天到期的卡片', '出一道 B 级单选题'],
  unrestricted: ['直接动手：整理下载文件夹', '查一下这台电脑哪里最占空间', '帮我写个脚本并跑起来'],
};

export function mountWelcome(host, signal) {
  const build = (room) => {
    const el = document.createElement('section');
    el.className = 'cle-welcome';
    el.dataset.room = room.id;
    el.innerHTML = `
      <figure class="cle-welcome__arch"><img alt="" decoding="async" src="${ART}${room.id}.webp"><span class="cle-welcome__rule" aria-hidden="true"></span></figure>
      <p class="cle-welcome__label cle-label">${room.fr} · ${room.zh}</p>
      <h2 class="cle-welcome__line">${room.line}</h2>
      <div class="cle-welcome__asks">${(SUGGEST[room.id] || []).map((s) => `<button type="button" class="cle-welcome__ask">${s}</button>`).join('')}</div>`;
    const img = el.querySelector('img');
    img.addEventListener('error', () => img.closest('figure').classList.add('is-empty'), {once: true});
    el.addEventListener('click', (e) => {
      const ask = e.target.closest('.cle-welcome__ask');
      if (!ask) return;
      const ta = document.querySelector('.cle-composer textarea, .agent-chat__composer-combobox textarea');
      if (!ta) return;
      // hand the words to the native composer as if typed; the native send stays in charge
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ask.textContent);
      ta.dispatchEvent(new Event('input', {bubbles: true}));
      ta.focus();
    });
    return el;
  };

  let current = null;
  const sync = () => {
    const host_ = document.querySelector('.agent-chat__welcome');
    const roomId = document.documentElement.dataset.cleRoom || 'chat';
    if (!host_) { current = null; return; }
    if (current?.isConnected && current.dataset.room === roomId && current.parentElement === host_) return;
    current?.remove();
    const room = ROOMS.find((r) => r.id === roomId) || ROOMS[0];
    current = build(room);
    host_.prepend(current);
  };
  let queued = false;
  const mo = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; sync(); }); } });
  mo.observe(document.body, {childList: true, subtree: true});
  const roomObserver = new MutationObserver(sync);
  roomObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['data-cle-room']});
  sync();
  signal.addEventListener('abort', () => { mo.disconnect(); roomObserver.disconnect(); current?.remove(); }, {once: true});
}
