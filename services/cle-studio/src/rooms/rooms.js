// The five rooms. Each room is one agent with its own sessions, model and tiers;
// switching rooms is a blink: the lids close, the room changes underneath, they open.
import {blink} from './blink.js';

export const ROOMS = [
  {id: 'chat', agent: 'main', zh: '雅叙', fr: 'Le Chat', hint: '闲谈 · 陪伴', line: '坐下来，慢慢说。'},
  {id: 'project', agent: 'project', zh: '营造', fr: 'Œuvre', hint: '项目 · 动手', line: '图纸摊开，从最小的一步做起。'},
  {id: 'thinking', agent: 'thinking', zh: '堇思', fr: 'Pensée', hint: '想法 · 推敲', line: '夜里的念头，先别急着赶走。'},
  {id: 'learning', agent: 'learning', zh: '习作', fr: 'Étude', hint: '学习 · 督促', line: '今天的这一页，陪你翻完。'},
  {id: 'unrestricted', agent: 'unrestricted', zh: '挥洒', fr: 'Carte Blanche', hint: '无限 · 放手', line: '白纸一张，随你落笔。'},
];
export const roomArt = (id) => `/cle/static/art/rooms/${id}.webp`;
const byAgent = new Map(ROOMS.map((r) => [r.agent, r]));
const LAST = (room) => `cle:last-session:${room}`;

export function roomForAgent(agentId) { return byAgent.get(agentId) || ROOMS[0]; }

export function mountRooms(host, signal) {
  const html = document.documentElement;
  let current = roomForAgent(host.agents?.selectedId);
  let switching = false;

  const applyRoom = (room) => {
    current = room;
    html.dataset.cleRoom = room.id;
    selector.querySelector('.cle-room__zh').textContent = room.zh;
    selector.querySelector('.cle-room__fr').textContent = room.fr;
    selector.querySelector('.cle-room__thumb').style.backgroundImage = `url("${roomArt(room.id)}")`;
    selector.title = `${room.zh} · ${room.fr} — ${room.hint}`;
    for (const item of menu.querySelectorAll('[data-room]')) item.setAttribute('aria-current', String(item.dataset.room === room.id));
  };

  // ---- selector (top of the sidebar) ----
  const selector = document.createElement('button');
  selector.type = 'button';
  selector.className = 'cle-room';
  selector.setAttribute('aria-haspopup', 'menu');
  selector.innerHTML = `<span class="cle-room__thumb" aria-hidden="true"></span><span class="cle-room__names"><span class="cle-room__zh"></span><span class="cle-room__fr"></span></span><svg class="cle-room__chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;

  const menu = document.createElement('div');
  menu.className = 'cle-room-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  menu.innerHTML = ROOMS.map((r, i) => `<button type="button" role="menuitemradio" class="cle-room-menu__item" data-room="${r.id}"><span class="cle-room-menu__thumb" style="background-image:url('${roomArt(r.id)}')"></span><span class="cle-room-menu__names"><span class="cle-room-menu__zh">${r.zh}<em>${r.fr}</em></span><span class="cle-room-menu__hint">${r.hint}</span></span><kbd class="cle-room-menu__key">⌘${i + 1}</kbd></button>`).join('');
  document.body.append(menu);

  const placeMenu = () => {
    const r = selector.getBoundingClientRect();
    menu.style.left = `${Math.round(r.left)}px`;
    menu.style.top = `${Math.round(r.bottom + 6)}px`;
    menu.style.minWidth = `${Math.max(220, Math.round(r.width))}px`;
  };
  const openMenu = (open) => {
    menu.hidden = !open;
    selector.setAttribute('aria-expanded', String(open));
    if (open) { placeMenu(); menu.querySelector('[aria-current="true"]')?.focus({preventScroll: true}); }
  };
  selector.addEventListener('click', () => openMenu(menu.hidden));
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-room]');
    if (!item) return;
    openMenu(false);
    go(ROOMS.find((r) => r.id === item.dataset.room));
  });
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !selector.contains(e.target)) openMenu(false);
  }, {signal});
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) { openMenu(false); selector.focus(); return; }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && /^[1-5]$/.test(e.key)) {
      e.preventDefault();
      go(ROOMS[Number(e.key) - 1]);
    }
  }, {signal, capture: true});

  // ---- switching ----
  const rememberSession = () => {
    const key = host.sessions?.selectedKey;
    if (key && key.startsWith(`agent:${current.agent}:`)) try { localStorage.setItem(LAST(current.id), key); } catch {}
  };
  const settled = () => new Promise((resolve) => {
    // the new room is ready when the agent is selected and the composer is on screen two frames in a row
    const start = performance.now();
    let seen = 0;
    const check = () => {
      const ok = host.agents?.selectedId === targetAgent && document.querySelector('.agent-chat__input');
      seen = ok ? seen + 1 : 0;
      if (seen >= 2 || performance.now() - start > 2600) resolve();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
  let targetAgent = current.agent;

  async function go(room) {
    if (!room || switching || room.id === current.id) return;
    switching = true;
    rememberSession();
    targetAgent = room.agent;
    let sessionKey = `agent:${room.agent}:main`;
    try { sessionKey = localStorage.getItem(LAST(room.id)) || sessionKey; } catch {}
    try {
      await blink(room, async () => {
        host.agents.select(room.agent);
        try { await host.sessions.open({sessionKey, agentId: room.agent}); }
        catch { await host.sessions.open({sessionKey: `agent:${room.agent}:main`, agentId: room.agent}); }
        applyRoom(room);
        await settled();
      });
    } finally { switching = false; }
  }

  // ---- keep the selector mounted in the native sidebar ----
  const mark = document.createElement('span');
  mark.className = 'cle-brandmark';
  mark.setAttribute('aria-label', 'C.le.');
  mark.textContent = 'C.le.';
  const mount = () => {
    const brand = document.querySelector('.sidebar-brand');
    if (!brand) return;
    if (mark.parentElement !== brand) brand.prepend(mark);
    if (selector.parentElement !== brand) brand.append(selector);
  };
  mount();
  applyRoom(current);
  const mo = new MutationObserver(() => { if (!selector.isConnected || !mark.isConnected) mount(); });
  mo.observe(document.body, {childList: true, subtree: true});
  const unsubscribe = host.subscribe?.(() => {
    const room = roomForAgent(host.agents?.selectedId);
    if (room.id !== current.id && !switching) applyRoom(room);
    rememberSession();
  });

  signal.addEventListener('abort', () => {
    mo.disconnect(); unsubscribe?.(); selector.remove(); mark.remove(); menu.remove(); delete html.dataset.cleRoom;
  }, {once: true});
  return {go, get current() { return current; }};
}
