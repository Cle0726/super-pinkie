// The C.le. composer: the native composer, untouched in behaviour, inside a stage that
// gives it the quiet single-pill look and a ledge where the guardian rests.
let active = null;
// the composer currently on screen: its canonical draft/send operations (tests and the welcome asks use these)
export const composer = {
  get props() { return active?.props || null; },
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
