// The empty room: the room's painting is the whole pane (backdrop.js); over it, the room's name,
// one line in its voice, and a few things worth asking here. Replaces the stock avatar and suggestions.
import {ROOMS} from './rooms.js';
import {paneRoom, visiblePanes} from './split.js';

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
      <p class="cle-welcome__label"><span>${room.zh}</span><em>${room.fr}</em></p>
      <h2 class="cle-welcome__line">${room.line}</h2>
      <div class="cle-welcome__asks">${(SUGGEST[room.id] || []).map((s) => `<button type="button" class="cle-welcome__ask">${s}</button>`).join('')}</div>`;
    el.addEventListener('click', (e) => {
      const ask = e.target.closest('.cle-welcome__ask');
      if (!ask) return;
      window.CLE?.composer?.setDraft(ask.textContent);
      window.CLE?.composer?.focus();
    });
    return el;
  };

  // one welcome per visible pane, each in its own room (two in 双模式)
  const sync = () => {
    const fallback = document.documentElement.dataset.cleRoom || 'chat';
    for (const pane of visiblePanes()) {
      const host_ = pane.querySelector('.agent-chat__welcome');
      if (!host_) continue;
      const roomId = paneRoom(pane)?.id || (pane.classList.contains('chat-pane-cache__pane--active') ? fallback : null) || fallback;
      const cur = host_.querySelector(':scope > .cle-welcome');
      if (cur?.dataset.room === roomId) continue;
      cur?.remove();
      host_.prepend(build(ROOMS.find((r) => r.id === roomId) || ROOMS[0]));
    }
  };
  let queued = false;
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; sync(); }); } };
  const mo = new MutationObserver(schedule);
  mo.observe(document.body, {childList: true, subtree: true});
  const roomObserver = new MutationObserver(sync);
  roomObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['data-cle-room']});
  // cached panes swap which one is active without adding nodes
  const paneObserver = new MutationObserver(schedule);
  paneObserver.observe(document.body, {subtree: true, attributes: true, attributeFilter: ['class']});
  sync();
  signal.addEventListener('abort', () => { mo.disconnect(); roomObserver.disconnect(); paneObserver.disconnect(); document.querySelectorAll('.cle-welcome').forEach((w) => w.remove()); }, {once: true});
}
