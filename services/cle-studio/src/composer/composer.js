// The C.le. composer: the native composer, untouched in behaviour, inside a stage that
// gives it the quiet single-pill look and a ledge where the guardian rests.
//
// Tools are folded by meaning, never by position: each control in the lead is tagged with
// its role and a priority, and the fold only hides the low-priority ones in narrow panes.
// The panel belongs to one composer (one pane); opening it never moves or re-parents the
// native buttons, so a click still lands in the composer of the pane it came from.
import {mountPaneRooms} from './panes.js';

let active = null;
// the composer currently on screen: its canonical draft/send operations (tests and the welcome asks use these)
export const composer = {
  get props() { return active?.props || null; },
  get element() { return active?.inner || null; },
  setDraft(text) { active?.props?.setDraft?.(text); },
  send() { return active?.props?.send?.(); },
  focus() { active?.inner.querySelector('textarea')?.focus(); },
};

export function mountComposer(host, signal, {onStage} = {}) {
  // each pane carries its own room (双模式 can show two rooms at once); type and spacing read it
  mountPaneRooms(signal);
  const dispose = host.ui.registerReplacement({
    id: 'cle-composer',
    label: 'C.le.',
    surface: 'composer',
    mount(container, context) {
      container.classList.add('cle-composer');
      const ledge = document.createElement('div');
      ledge.className = 'cle-composer__ledge';
      const inner = document.createElement('div');
      inner.className = 'cle-composer__native';
      container.append(ledge, inner);
      const unmount = context.mountDefault(inner);
      const stage = {container, ledge, inner, props: context.props, presented: context.presented};
      const handle = onStage?.(stage);
      if (context.presented) active = stage;
      return {
        update(next) {
          stage.props = next.props; stage.presented = next.presented;
          if (next.presented) active = stage; else if (active === stage) active = null;
          container.classList.toggle('is-sending', Boolean(next.props?.sending));
          handle?.update?.(stage);
        },
        focus() { inner.querySelector('textarea')?.focus(); },
        dispose() { handle?.dispose?.(); unmount?.(); container.classList.remove('cle-composer'); ledge.remove(); inner.remove(); },
      };
    },
  });
  const select = () => { try { host.ui.selectReplacement('composer', 'cle-composer'); } catch (e) { console.warn('[cle] composer select', e); } };
  select();
  // selections clear on reconnect: take it again
  let wasConnected = host.connection?.connected;
  const unsub = host.subscribe?.(() => {
    const now = host.connection?.connected;
    if (now && !wasConnected) setTimeout(select, 0);
    wasConnected = now;
  });
  signal.addEventListener('abort', () => { unsub?.(); dispose?.(); }, {once: true});
}

// role -> priority. Essential controls stay on screen at every width; the rest fold.
// `attach` and `learning` are the entries the product must never lose in a narrow pane.
const ROLES = [
  [/laolao-learning-tools|laolao-learning-toggle/, 'learning', 'essential', '互动学习'],
  [/laolao-learning-notebook/, 'notes', 'low', '笔记本'],
  [/agent-chat__input-btn|capability|attach/, 'attach', 'essential', '附件与能力'],
  [/permission/, 'permission', 'normal', '权限'],
  [/chat-open-split-view|browser/, 'browser', 'low', '浏览器'],
  [/voice|dictat|talk/, 'voice', 'low', '语音'],
  [/effort|reasoning/, 'reasoning', 'essential', '推理'],
  [/model|inline-select/, 'model', 'essential', '模型'],
];

export function classifyTool(el) {
  const label = ` ${typeof el.className === 'string' ? el.className : el.className?.baseVal || ''} `;
  for (const [pattern, kind, priority, name] of ROLES) {
    if (pattern.test(label)) return {kind, priority, name};
  }
  return {kind: 'other', priority: 'normal', name: ''};
}

const toolName = (el, fallback) => (el.getAttribute?.('aria-label') || el.getAttribute?.('title') || el.dataset?.cleToolName || el.textContent?.trim() || fallback || '').slice(0, 28);
const isHidden = (el) => el.hidden || el.getAttribute?.('aria-hidden') === 'true';
// Entries the learning module absorbed into its own capsule stay in the lead for state, but they
// are visually merged with 学习工具. They must not reappear as fold proxies. Class-based on
// purpose: a computed `display:none` filter would also drop the low-priority controls that the
// fold itself hides.
const isAbsorbed = (el) => Boolean(el.classList?.contains('laolao-learning--absorbed'));

// The menu is a projection of the low-priority controls. A signature lets refresh() answer
// "did anything actually change?" — rebuilding on every frame would throw away focus and, since
// the rebuild mutates the page, feed the observer that triggered it.
const signatureOf = (rows) => rows
  .map((control) => [
    control.dataset?.cleTool || '',
    control.dataset?.cleToolName || '',
    control.disabled ? '1' : '0',
    control.getAttribute?.('aria-pressed') || '',
  ].join('|'))
  .join('~');

// Tag every control in one composer's lead; keep the existing tags when nothing changed so
// the MutationObserver cannot loop on itself.
function tagLead(composerEl, lead) {
  let low = 0;
  for (const child of [...lead.children]) {
    if (child.classList.contains('cle-tools-more') || child.classList.contains('cle-tools-menu')) continue;
    const {kind, priority, name} = classifyTool(child);
    if (child.dataset.cleTool !== kind) child.dataset.cleTool = kind;
    if (child.dataset.clePriority !== priority) child.dataset.clePriority = priority;
    const label = toolName(child, name);
    if (label && child.dataset.cleToolName !== label) child.dataset.cleToolName = label;
    if (priority === 'low') low += 1;
  }
  composerEl.classList.toggle('has-low-tools', low > 0);
  return low;
}

// One menu per composer. Items are proxies: activating one clicks the real control in this
// same lead, so state, aria and behaviour stay with the native button.
function buildMenu(composerEl, lead, trigger) {
  const menu = document.createElement('div');
  menu.className = 'cle-tools-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '更多工具');
  menu.hidden = true;
  document.body.append(menu);

  const items = () => [...lead.querySelectorAll(':scope > [data-cle-priority="low"]')]
    .filter((el) => !isHidden(el) && !isAbsorbed(el));
  // what is on screen right now: the signature plus the row nodes, so focus can be kept
  let rendered = {signature: null, rows: []};
  const place = () => {
    const r = trigger.getBoundingClientRect();
    const width = Math.max(180, Math.min(260, window.innerWidth - 24));
    menu.style.width = `${width}px`;
    menu.style.left = `${Math.round(Math.min(window.innerWidth - width - 12, Math.max(12, r.left)))}px`;
    const below = r.bottom + 8;
    menu.style.top = `${Math.round(below + menu.offsetHeight > window.innerHeight - 12 ? Math.max(12, r.top - menu.offsetHeight - 8) : below)}px`;
  };
  const close = ({restore = false} = {}) => {
    if (menu.hidden) return;
    menu.hidden = true;
    rendered = {signature: null, rows: []};
    trigger.setAttribute('aria-expanded', 'false');
    if (restore) trigger.focus({preventScroll: true});
  };
  // Rebuild only when the set of controls changed. `focusIndex` keeps the keyboard where it was.
  // Focus is applied by the caller *after* the menu is shown: focusing an element inside a
  // `hidden` container is a no-op in every browser, which left ArrowDown focusing the trigger.
  const render = (rows) => {
    menu.replaceChildren();
    rendered = {signature: signatureOf(rows), rows};
    for (const control of rows) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'cle-tools-menu__item';
      item.setAttribute('role', 'menuitem');
      item.dataset.cleTool = control.dataset.cleTool || 'other';
      item.textContent = control.dataset.cleToolName || '工具';
      if (control.getAttribute('aria-pressed') === 'true') item.setAttribute('aria-pressed', 'true');
      if (control.disabled) item.disabled = true;
      item.addEventListener('click', (event) => {
        event.stopPropagation();
        close({restore: true});
        control.click();
      });
      menu.append(item);
    }
  };
  const focusRow = (index = 0) => {
    const rows = [...menu.querySelectorAll('.cle-tools-menu__item')];
    if (!rows.length) return;
    rows[Math.max(0, Math.min(index, rows.length - 1))].focus({preventScroll: true});
  };
  const open = () => {
    const rows = items();
    if (!rows.length) return;
    render(rows);
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    place();
    focusRow(0);
  };
  // called on every observer pass: reposition, and rebuild only if the controls really changed
  const refresh = () => {
    if (menu.hidden) return;
    const rows = items();
    if (!rows.length) { close(); return; }
    if (signatureOf(rows) === rendered.signature) { place(); return; }
    const active = [...menu.children].indexOf(document.activeElement);
    render(rows);
    place();
    if (active >= 0) focusRow(active);
  };

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menu.hidden) open(); else close();
  });
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(); }
    if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); event.stopPropagation(); close({restore: true}); }
  });
  menu.addEventListener('keydown', (event) => {
    const rows = [...menu.querySelectorAll('.cle-tools-menu__item')];
    const at = rows.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close({restore: true}); }
    if (event.key === 'ArrowDown') { event.preventDefault(); rows[(at + 1) % rows.length]?.focus(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); rows[(at - 1 + rows.length) % rows.length]?.focus(); }
    if (event.key === 'Tab') close();
  });
  const outside = (event) => { if (!menu.hidden && !menu.contains(event.target) && !trigger.contains(event.target)) close(); };
  const onResize = () => close();
  const onScroll = () => close();
  document.addEventListener('pointerdown', outside, true);
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onScroll, true);
  // This stage owns its own controller. Binding stages to the plugin's global signal would leave
  // one abort listener per stage on that signal forever: a re-rendered pane disposes its stage but
  // the signal keeps the closure (and the removed DOM) alive, and the next mount adds another.
  const controller = new AbortController();
  const dispose = () => {
    if (controller.signal.aborted) return;
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('scroll', onScroll, true);
    close();
    menu.remove();
    controller.abort();
  };

  return {menu, close, open, refresh, dispose, get signature() { return rendered.signature; }};
}

// narrow panes fold the rarely used tools behind ⋯ (CSS decides when it is shown)
export function mountToolFold(signal) {
  const stages = new Map();
  // nodes this module wrote: the trigger buttons and the menus themselves
  const ownNodes = new WeakSet();
  // Widths measured while the low-priority controls were still visible. Folding hides them, so
  // without this cache the next measurement would read 0 and immediately unfold again.
  const lowWidth = new WeakMap();
  const GAP = 2;

  // Fold on real occupancy, not on a pane-width guess: an 864px composer fits the tools on one
  // row, while a 508px split pane does not. Essential controls keep their measured width; low
  // ones use the last visible width (or a conservative estimate before the first measurement).
  const measure = (composerEl, lead, more) => {
    const available = lead.clientWidth;
    if (!available) return null;
    let essential = 0;
    let low = 0;
    // A control whose own rect is 0x0 contributes nothing of its own: either it is hidden
    // (display:contents hosts, absorbed entries) or its visible children carry the box. Measure
    // the descendants in that case, otherwise a `display:contents` host hides a 532px trigger
    // from the accounting and the fold believes there is room it does not have.
    const widthOf = (el) => {
      const own = el.getBoundingClientRect().width;
      if (own > 0) return own;
      let total = 0;
      for (const child of el.children || []) total += widthOf(child);
      return total;
    };
    for (const child of lead.children) {
      if (child === more) continue;
      const width = widthOf(child);
      if (child.dataset.clePriority === 'low') {
        if (width > 0) lowWidth.set(child, width);
        low += width > 0 ? width : lowWidth.get(child) || 88;
      } else if (width > 0) {
        essential += width + GAP;
      }
    }
    const moreWidth = 28 + GAP;
    return {fits: essential + low + moreWidth <= available, tight: essential + moreWidth > available};
  };
  const sync = () => {
    for (const composerEl of document.querySelectorAll('.cle-composer')) {
      const lead = composerEl.querySelector('.agent-chat__composer-lead');
      if (!lead) continue;
      let stage = stages.get(composerEl);
      if (!stage) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'cle-tools-more';
        more.title = '更多工具';
        more.setAttribute('aria-label', '更多工具');
        more.setAttribute('aria-haspopup', 'menu');
        more.setAttribute('aria-expanded', 'false');
        more.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/></svg>';
        lead.append(more);
        stage = {...buildMenu(composerEl, lead, more), more};
        ownNodes.add(more);
        ownNodes.add(stage.menu);
        stages.set(composerEl, stage);
      }
      if (stage.more.parentElement !== lead) lead.append(stage.more);
      const low = tagLead(composerEl, lead);
      stage.more.hidden = low === 0;
      const fit = low ? measure(composerEl, lead, stage.more) : null;
      if (fit) {
        // `tight` means even the essentials do not fit: keep the low entries folded and let the
        // lead wrap rather than dropping controls the product requires.
        const crowded = !fit.fits || fit.tight;
        if (composerEl.classList.contains('is-crowded') !== crowded) composerEl.classList.toggle('is-crowded', crowded);
      } else if (composerEl.classList.contains('is-crowded')) {
        composerEl.classList.remove('is-crowded');
      }
      stage.refresh();
    }
    for (const [composerEl, stage] of stages) {
      if (composerEl.isConnected) continue;
      stage.dispose();
      stages.delete(composerEl);
    }
  };
  let q = false;
  // Our own menu and trigger live in the observed tree. Without filtering, opening the menu
  // (replaceChildren + append) wakes the observer, which calls refresh(), which would rebuild
  // again — a loop that also reset the keyboard selection every frame.
  const isOwnNode = (node) => {
    if (!node) return false;
    if (ownNodes.has(node)) return true;
    const element = node.nodeType === 1 ? node : node.parentElement;
    return Boolean(element?.closest?.('.cle-tools-menu, .cle-tools-more'));
  };
  // A record is "ours" when it happened inside our own menu/trigger, or when the only nodes it
  // added or removed are ours. Records touching native controls still schedule a real sync.
  const isOurs = (record) => {
    if (record.type !== 'childList') return isOwnNode(record.target);
    const touched = [...record.addedNodes, ...record.removedNodes];
    if (isOwnNode(record.target)) return true;
    return touched.length > 0 && touched.every(isOwnNode);
  };
  const mo = new MutationObserver((records) => {
    if (records.every(isOurs)) return;
    if (q) return;
    q = true;
    requestAnimationFrame(() => { q = false; sync(); });
  });
  mo.observe(document.body, {childList: true, subtree: true});
  sync();
  signal.addEventListener('abort', () => {
    mo.disconnect();
    for (const stage of stages.values()) stage.dispose();
    stages.clear();
    document.querySelectorAll('.cle-tools-more').forEach((b) => b.remove());
  }, {once: true});
}
