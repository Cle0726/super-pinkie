// What the 2026.7 modules expected from the old skin, rebuilt on the plugin host API:
//  - window.__laolaoSidebar.gwRequest(method, params, timeoutMs)  → host.request
//  - window 'pinkie:gateway-event' {detail: {event, payload}}      ← host.onEvent relay
//  - laolao:sessions-changed when the session list changes
const RELAYED = ['agent', 'chat', 'session.message', 'session.tool', 'sessions.changed', 'plugin.pinkie.lsp.message', 'plugin.pinkie.ext.progress', 'plugin.pinkie.ai.scan'];

export function installLegacyShim(host, signal) {
  const gwRequest = (method, params, timeoutMs = 15000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('gateway timeout')), timeoutMs);
    host.request(method, params || {}).then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
  const sidebar = window.__laolaoSidebar || {};
  sidebar.gwRequest = gwRequest;
  sidebar.currentSessionKey = () => host.sessions?.selectedKey || '';
  window.__laolaoSidebar = sidebar;
  window.__cleGateway = {request: gwRequest, host};

  let lastSession = host.sessions?.selectedKey;
  let lastMode = document.documentElement.dataset.cleRoom;
  const syncSelection = () => {
    const session = host.sessions?.selectedKey;
    const mode = document.documentElement.dataset.cleRoom;
    if (mode !== lastMode) {
      lastMode = mode;
      window.dispatchEvent(new CustomEvent('laolao:modechange', {detail: {mode}}));
    }
    if (session !== lastSession) {
      lastSession = session;
      window.dispatchEvent(new CustomEvent('laolao:sessions-changed'));
      // A memory editor belongs to the scope in which it was opened.
      window.__clekkMemoryUI?.close();
    }
  };
  const offSelection = host.subscribe?.(syncSelection);
  const modeObserver = new MutationObserver(syncSelection);
  modeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['data-cle-room']});

  const offs = RELAYED.map((name) => host.onEvent(name, (payload) => {
    window.dispatchEvent(new CustomEvent('pinkie:gateway-event', {detail: {event: name, payload}}));
    if (name === 'sessions.changed') window.dispatchEvent(new CustomEvent('laolao:sessions-changed'));
  }));
  signal.addEventListener('abort', () => { for (const off of offs) off?.(); offSelection?.(); modeObserver.disconnect(); }, {once: true});
}
