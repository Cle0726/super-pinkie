// The five rooms. Each room is one agent with its own sessions, model and tiers;
// switching rooms is a blink: the lids close, the room changes underneath, they open.
import {blink} from './blink.js';
import {modeSwitches} from '../core/modes.js';
import {openBeside, mountSplitBadges} from './split.js';

export const ROOMS = [
  {id: 'chat', eye: [.40, .38], agent: 'main', zh: '雅叙', fr: 'Le Chat', hint: '闲谈 · 陪伴', line: '坐下来，慢慢说。'},
  {id: 'project', eye: [.60, .41], agent: 'project', zh: '营造', fr: 'Œuvre', hint: '项目 · 动手', line: '图纸摊开，从最小的一步做起。'},
  {id: 'thinking', eye: [.38, .28], agent: 'thinking', zh: '堇思', fr: 'Pensée', hint: '想法 · 推敲', line: '夜里的念头，先别急着赶走。'},
  {id: 'learning', eye: [.35, .30], agent: 'learning', zh: '习作', fr: 'Étude', hint: '学习 · 督促', line: '今天的这一页，陪你翻完。'},
  {id: 'unrestricted', eye: [.50, .37], agent: 'unrestricted', zh: '挥洒', fr: 'Carte Blanche', hint: '无限 · 放手', line: '白纸一张，随你落笔。'},
];
// the revision stamp makes a repainted room reach WebKit at once instead of after the cache expires
export const ART_REV = '20261019r';
export const roomArt = (id) => `/cle/static/art/rooms/${id}.webp?v=${ART_REV}`;
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
    setThumb(selector.querySelector('.cle-room__thumb'), room);
    selector.title = `${room.zh} · ${room.fr} — ${room.hint}`;
    for (const item of menu.querySelectorAll('[data-room]')) item.setAttribute('aria-current', String(item.dataset.room === room.id));
  };

  // the room's painting, whole, in a small arched window (painted close-ups of his face will
  // replace it when Codex can paint them; never a crop of a full painting)
  function setThumb(el, room) {
    el.replaceChildren(); el.classList.remove('is-line');
    el.style.backgroundImage = `url("${roomArt(room.id)}")`;
  }

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
  menu.innerHTML = ROOMS.map((r, i) => `<button type="button" role="menuitemradio" class="cle-room-menu__item" data-room="${r.id}"><span class="cle-room-menu__thumb"></span><span class="cle-room-menu__names"><span class="cle-room-menu__zh">${r.zh}<em>${r.fr}</em></span><span class="cle-room-menu__hint">${r.hint}</span></span><kbd class="cle-room-menu__key">⌘${i + 1}</kbd></button>`).join('');
  // 双模式: pick a second room to open beside this one
  const dual = document.createElement('button');
  dual.type = 'button'; dual.className = 'cle-room-menu__dual';
  dual.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M12 5v14"/></svg>双模式<em>Deux pièces</em>';
  const pickHint = document.createElement('div'); pickHint.className = 'cle-room-menu__pickhint'; pickHint.textContent = '选另一间，放在旁边同时进行';
  dual.addEventListener('click', (e) => { e.stopPropagation(); menu.dataset.picking = menu.dataset.picking === 'dual' ? '' : 'dual'; });
  menu.prepend(pickHint);
  const switches = modeSwitches();
  menu.append(dual, switches);
  document.body.append(menu);
  for (const item of menu.querySelectorAll('[data-room]')) setThumb(item.querySelector('.cle-room-menu__thumb'), ROOMS.find((r) => r.id === item.dataset.room));

  const placeMenu = () => {
    const r = selector.getBoundingClientRect();
    menu.style.left = `${Math.round(r.left)}px`;
    menu.style.top = `${Math.round(r.bottom + 6)}px`;
    menu.style.minWidth = `${Math.max(220, Math.round(r.width))}px`;
  };
  const openMenu = (open) => {
    if (!open) menu.dataset.picking = '';
    menu.hidden = !open;
    selector.setAttribute('aria-expanded', String(open));
    if (open) { switches.refresh(); placeMenu(); menu.querySelector('[aria-current="true"]')?.focus({preventScroll: true}); }
  };
  selector.addEventListener('click', () => openMenu(menu.hidden));
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-room]');
    if (!item) return;
    const target = ROOMS.find((r) => r.id === item.dataset.room);
    const picking = menu.dataset.picking === 'dual';
    menu.dataset.picking = '';
    openMenu(false);
    if (picking) openBeside(host, target).catch((err) => console.warn('[cle] dual', err));
    else go(target);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !selector.contains(e.target)) openMenu(false);
  }, {signal});
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) { openMenu(false); selector.focus(); return; }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && /^Digit[1-5]$/.test(e.code)) {
      e.preventDefault();
      openBeside(host, ROOMS[Number(e.code.slice(5)) - 1]).catch((err) => console.warn('[cle] dual', err));
      return;
    }
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
      const pane = document.querySelector('.chat-pane-cache__pane--active');
      const ok = host.agents?.selectedId === targetAgent && document.querySelector('.agent-chat__input')
        && (pane?.querySelector('.cle-welcome, .chat-group') || performance.now() - start > 1400);
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
  mountSplitBadges(signal, host);
  // the paintings are seen through the blink, so have them decoded before the first switch
  (window.requestIdleCallback || ((f) => setTimeout(f, 1200)))(() => ROOMS.forEach((r) => { const i = new Image(); i.decoding = 'async'; i.src = roomArt(r.id); }));
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
