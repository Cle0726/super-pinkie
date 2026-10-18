// 双模式 — two rooms side by side (the original app's split workspace, on the native split view): study on one
// side while the project runs on the other. Each pane keeps its own room, session, model and status; the room
// selector follows whichever pane has focus, and Li An (the pet) moves to where you are working.
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
export function mountSplitBadges(signal) {
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
      badge = document.createElement('div'); badge.className = 'cle-pane-badge'; badge.dataset.room = room.id;
      const icon = document.createElement('span'); icon.className = 'cle-pane-badge__icon';
      loadLine(`mode-${room.id}`).then((d) => { if (d) icon.append(lineArt(`mode-${room.id}`, {draw: true, speed: 200})); else icon.style.backgroundImage = `url("${roomArt(room.id)}")`; });
      badge.append(icon, Object.assign(document.createElement('b'), {textContent: room.zh}), Object.assign(document.createElement('em'), {textContent: room.fr}));
      cell.prepend(badge);
    }
  };
  let q = false;
  const schedule = () => { if (!q) { q = true; requestAnimationFrame(() => { q = false; sync(); }); } };
  const mo = new MutationObserver(schedule);
  mo.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'data-mcp-app-owner-key']});
  sync();
  signal.addEventListener('abort', () => { mo.disconnect(); document.querySelectorAll('.cle-pane-badge').forEach((b) => b.remove()); }, {once: true});
}
