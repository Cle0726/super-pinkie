// 双模式 — two rooms side by side (the original app's split workspace, on the native split view): study on one
// side while the project runs on the other. Each pane keeps its own room, session, model and status; the room
// selector follows whichever pane has focus, and 碧琪 (the pet) moves to where you are working.
import {ROOMS, roomArt} from './rooms.js';
import {lineArt, loadLine} from '../line/line.js';

export function paneSessionKey(pane) {
  try { const v = JSON.parse(pane?.dataset?.mcpAppOwnerKey || 'null'); return Array.isArray(v) ? String(v[1] || '') : ''; } catch { return ''; }
}
export function paneRoom(pane) {
  const agent = (paneSessionKey(pane).match(/^agent:([^:]+):/) || [])[1];
  return ROOMS.find((r) => r.agent === agent) || null;
}
export const visiblePanes = () => [...document.querySelectorAll('.chat-pane-cache__pane--visible, .chat-pane-cache__pane--active')];
export const isSplit = () => document.querySelectorAll('.chat-split-view__cell').length > 1;

const LAST = (room) => `cle:last-session:${room}`;
const until = (test, ms = 3000) => new Promise((resolve) => { const t0 = performance.now(); const f = () => (test() || performance.now() - t0 > ms) ? resolve(test()) : requestAnimationFrame(f); f(); });

// open `room` next to the current pane
export async function openBeside(host, room) {
  if (!isSplit()) {
    const btn = document.querySelector('.chat-pane-cache__pane--active .chat-open-split-view') || document.querySelector('.chat-open-split-view');
    if (!btn) throw new Error('分屏不可用');
    btn.click();
    await until(isSplit);
  }
  let sessionKey = `agent:${room.agent}:main`;
  try { sessionKey = localStorage.getItem(LAST(room.id)) || sessionKey; } catch {}
  host.agents.select(room.agent);
  try { await host.sessions.open({sessionKey, agentId: room.agent}); }
  catch { await host.sessions.open({sessionKey: `agent:${room.agent}:main`, agentId: room.agent}); }
}

// a small room badge on each pane while split, so you always know which side is which
// the history of one pane's room, opened from its badge; picking a conversation loads it into that pane
let pop = null;
function closePop() { pop?.remove(); pop = null; }
async function openHistory(host, cell, room, anchor) {
  closePop();
  // focus this pane first, so the native navigation lands in it
  cell.querySelector('.chat-pane-cache__pane--visible, .chat-pane-cache__pane')?.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
  cell.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
  pop = document.createElement('div'); pop.className = 'cle-history'; pop.setAttribute('role', 'menu');
  pop.innerHTML = `<div class="cle-history__head"><b>${room.zh}</b><em>${room.fr}</em><span>历史会话</span></div><div class="cle-history__list"><p class="cle-history__empty">正在读取…</p></div>`;
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${Math.round(r.bottom + 8)}px`;
  pop.style.left = `${Math.round(Math.min(window.innerWidth - 336, Math.max(12, r.right - 320)))}px`;
  const list = pop.querySelector('.cle-history__list');
  try {
    const res = await host.request('sessions.list', {agentId: room.agent, limit: 60, includeDerivedTitles: true});
    const rows = (res.sessions || []).filter((s) => s.key?.startsWith(`agent:${room.agent}:`) && !s.key.includes(':subagent:'));
    const current = paneSessionKey(cell.querySelector('.chat-pane-cache__pane--visible, .chat-pane-cache__pane'));
    list.replaceChildren(...[{key: `agent:${room.agent}:main`, label: '主会话'}, ...rows.filter((s) => s.key !== `agent:${room.agent}:main`)].slice(0, 60).map((s) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'cle-history__row'; b.setAttribute('role', 'menuitem');
      if (s.key === current) b.setAttribute('aria-current', 'true');
      b.textContent = s.label || s.displayName || s.derivedTitle || s.title || s.key.split(':').pop().slice(0, 8);
      b.addEventListener('click', async () => {
        closePop();
        host.agents.select(room.agent);
        try { localStorage.setItem(LAST(room.id), s.key); } catch {}
        await host.sessions.open({sessionKey: s.key, agentId: room.agent}).catch(() => {});
      });
      return b;
    }));
    const fresh = document.createElement('button'); fresh.type = 'button'; fresh.className = 'cle-history__new'; fresh.textContent = '＋ 在这一侧开新会话';
    fresh.addEventListener('click', async () => {
      closePop(); host.agents.select(room.agent);
      const key = await host.sessions.create({agentId: room.agent, label: `新会话 ${new Date().toTimeString().slice(0, 5)}`}).catch(() => null);
      if (key) await host.sessions.open({sessionKey: key, agentId: room.agent}).catch(() => {});
    });
    pop.append(fresh);
  } catch (error) { list.innerHTML = `<p class="cle-history__empty">读不到历史：${String(error.message || error)}</p>`; }
}

export function mountSplitBadges(signal, host) {
  const sync = () => {
    const split = isSplit();
    document.documentElement.toggleAttribute('data-cle-split', split);
    for (const cell of document.querySelectorAll('.chat-split-view__cell')) {
      const pane = cell.querySelector('.chat-pane-cache__pane--visible, .chat-pane-cache__pane--active') || cell.querySelector('.chat-pane-cache__pane');
      const room = paneRoom(pane);
      let badge = cell.querySelector(':scope > .cle-pane-badge');
      if (!split || !room) { badge?.remove(); continue; }
      if (badge?.dataset.room === room.id) continue;
      badge?.remove();
      badge = document.createElement('button'); badge.type = 'button'; badge.className = 'cle-pane-badge'; badge.dataset.room = room.id;
      badge.title = `${room.zh} · 历史会话`; badge.setAttribute('aria-haspopup', 'menu');
      badge.addEventListener('click', (e) => { e.stopPropagation(); if (pop) { closePop(); return; } openHistory(host, cell, room, badge).catch((err) => console.warn('[cle] history', err)); });
      const icon = document.createElement('span'); icon.className = 'cle-pane-badge__icon';
      loadLine(`mode-${room.id}`).then((d) => { if (d) icon.append(lineArt(`mode-${room.id}`, {draw: true, speed: 200})); else icon.style.backgroundImage = `url("${roomArt(room.id)}")`; });
      const chev = document.createElement('i'); chev.className = 'cle-pane-badge__chev';
      badge.append(icon, Object.assign(document.createElement('b'), {textContent: room.zh}), Object.assign(document.createElement('em'), {textContent: room.fr}), chev);
      cell.prepend(badge);
    }
  };
  let q = false;
  const schedule = () => { if (!q) { q = true; requestAnimationFrame(() => { q = false; sync(); }); } };
  const mo = new MutationObserver(schedule);
  mo.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'data-mcp-app-owner-key']});
  sync();
  document.addEventListener('pointerdown', (e) => { if (pop && !pop.contains(e.target) && !e.target.closest?.('.cle-pane-badge')) closePop(); }, {signal});
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); }, {signal});
  signal.addEventListener('abort', () => { mo.disconnect(); closePop(); document.querySelectorAll('.cle-pane-badge').forEach((b) => b.remove()); }, {once: true});
}
