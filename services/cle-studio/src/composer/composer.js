// The C.le. composer: the native composer, untouched in behaviour, inside a stage that
// gives it the quiet single-pill look and a ledge where the guardian rests.
//
// Tools are folded by meaning, never by position: each control in the lead is tagged with
// its role and a priority, and the fold only hides the low-priority ones in narrow panes.
// The panel belongs to one composer (one pane); opening it never moves or re-parents the
// native buttons, so a click still lands in the composer of the pane it came from.
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

  const items = () => [...lead.querySelectorAll(':scope > [data-cle-priority="low"]')].filter((el) => !isHidden(el));
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
    trigger.setAttribute('aria-expanded', 'false');
    if (restore) trigger.focus({preventScroll: true});
  };
  const open = () => {
    menu.replaceChildren();
    const rows = items();
    if (!rows.length) return;
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
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    place();
    menu.querySelector('.cle-tools-menu__item')?.focus({preventScroll: true});
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
  document.addEventListener('pointerdown', outside, true);
  window.addEventListener('resize', () => close());
  window.addEventListener('scroll', () => close(), true);

  return {menu, close, open, refresh() { if (!menu.hidden) open(); }};
}

// narrow panes fold the rarely used tools behind ⋯ (CSS decides when it is shown)
export function mountToolFold(signal) {
  const stages = new Map();
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
        stages.set(composerEl, stage);
      }
      if (stage.more.parentElement !== lead) lead.append(stage.more);
      const low = tagLead(composerEl, lead);
      stage.more.hidden = low === 0;
      stage.refresh();
    }
    for (const [composerEl, stage] of stages) {
      if (composerEl.isConnected) continue;
      stage.close();
      stage.menu.remove();
      stages.delete(composerEl);
    }
  };
  let q = false;
  const mo = new MutationObserver(() => { if (!q) { q = true; requestAnimationFrame(() => { q = false; sync(); }); } });
  mo.observe(document.body, {childList: true, subtree: true});
  sync();
  signal.addEventListener('abort', () => {
    mo.disconnect();
    for (const stage of stages.values()) { stage.close(); stage.menu.remove(); }
    stages.clear();
    document.querySelectorAll('.cle-tools-more').forEach((b) => b.remove());
  }, {once: true});
}
