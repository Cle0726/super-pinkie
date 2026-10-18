// The C.le. composer: the native composer, untouched in behaviour, inside a stage that
// gives it the quiet single-pill look and a ledge where the guardian rests.
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
      return {
        update(next) {
          stage.props = next.props; stage.presented = next.presented;
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
