// The room is a painting you are sitting inside. Each split-view cell carries its room's oil
// painting behind the conversation: in an empty room it is the whole picture (the welcome is
// set over it); once there is talk it recedes into the margins and the dark, so the words stay
// calm, and it breathes very slowly. Changing room crossfades one painting into the next.
import {ROOMS, roomArt} from './rooms.js';
import {paneRoom, visiblePanes} from './split.js';

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mountBackdrop(signal) {
  const layers = new Map();            // cell → {el, room}

  const ensure = (cell) => {
    let entry = layers.get(cell);
    if (entry?.el.isConnected && entry.el.parentElement === cell) return entry;
    const el = document.createElement('div');
    el.className = 'cle-backdrop';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div class="cle-backdrop__canvas"></div><i class="cle-backdrop__paint"></i><i class="cle-backdrop__paint"></i><div class="cle-backdrop__veil"></div>';
    cell.prepend(el);
    entry = {el, room: null, front: 0};
    layers.set(cell, entry);
    return entry;
  };

  const show = (entry, room) => {
    if (entry.room === room.id) return;
    const paints = entry.el.querySelectorAll('.cle-backdrop__paint');
    const next = paints[entry.front ^ 1], prev = paints[entry.front];
    next.style.backgroundImage = `url("${roomArt(room.id)}")`;
    const swap = () => {
      next.classList.add('is-front'); prev.classList.remove('is-front');
      entry.front ^= 1;
    };
    // decode before showing, so the crossfade never flashes an empty frame
    const img = new Image(); img.decoding = 'async'; img.src = roomArt(room.id);
    (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(swap);
    entry.room = room.id;
    entry.el.dataset.room = room.id;
  };

  const sync = () => {
    const seen = new Set();
    for (const pane of visiblePanes()) {
      const cell = pane.closest('.chat-split-view__cell');
      if (!cell || seen.has(cell)) continue;
      seen.add(cell);
      const entry = ensure(cell);
      const room = paneRoom(pane) || ROOMS.find((r) => r.id === document.documentElement.dataset.cleRoom) || ROOMS[0];
      show(entry, room);
      // an empty room shows the whole painting; a conversation lets it recede
      const empty = !pane.querySelector('.chat-group') || Boolean(pane.querySelector('.cle-welcome'));
      entry.el.classList.toggle('is-empty', empty);
      pane.classList.toggle('cle-room-empty', empty);
      entry.el.classList.toggle('is-narrow', cell.clientWidth < 760);
    }
    for (const [cell, entry] of layers) if (!cell.isConnected || !seen.has(cell)) { if (!cell.isConnected) { entry.el.remove(); layers.delete(cell); } }
    document.documentElement.classList.toggle('cle-still', reduce());
  };

  let queued = false;
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; sync(); }); } };
  const mo = new MutationObserver(schedule);
  mo.observe(document.body, {childList: true, subtree: true});
  const attr = new MutationObserver(schedule);
  attr.observe(document.documentElement, {attributes: true, attributeFilter: ['data-cle-room', 'data-theme', 'data-theme-mode']});
  sync();
  signal.addEventListener('abort', () => { mo.disconnect(); attr.disconnect(); for (const {el} of layers.values()) el.remove(); layers.clear(); document.querySelectorAll('.cle-room-empty').forEach((p) => p.classList.remove('cle-room-empty')); }, {once: true});
}
