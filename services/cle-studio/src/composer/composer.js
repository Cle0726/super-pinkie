// The C.le. composer: the native composer, untouched in behaviour, inside a stage that
// gives it the quiet single-pill look and a ledge where the guardian rests.
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

// narrow panes fold the rarely used tools behind ⋯ (CSS decides when it is shown)
export function mountToolFold(signal) {
  const sync = () => {
    for (const lead of document.querySelectorAll('.cle-composer .agent-chat__composer-lead')) {
      if (lead.querySelector(':scope > .cle-tools-more')) continue;
      const more = document.createElement('button');
      more.type = 'button'; more.className = 'cle-tools-more'; more.title = '更多工具'; more.setAttribute('aria-label', '更多工具');
      more.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/></svg>';
      more.addEventListener('click', (e) => { e.stopPropagation(); lead.classList.toggle('is-open'); more.setAttribute('aria-expanded', String(lead.classList.contains('is-open'))); });
      lead.append(more);
    }
  };
  let q = false;
  const mo = new MutationObserver(() => { if (!q) { q = true; requestAnimationFrame(() => { q = false; sync(); }); } });
  mo.observe(document.body, {childList: true, subtree: true});
  sync();
  signal.addEventListener('abort', () => { mo.disconnect(); document.querySelectorAll('.cle-tools-more').forEach((b) => b.remove()); }, {once: true});
}
