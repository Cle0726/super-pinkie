// What the 2026.7 modules expected from the old skin, rebuilt on the plugin host API:
//  - window.__laolaoSidebar.gwRequest(method, params, timeoutMs)  → host.request
//  - window 'pinkie:gateway-event' {detail: {event, payload}}      ← host.onEvent relay
//  - laolao:sessions-changed when the session list changes
const RELAYED = ['agent', 'chat', 'sessions.changed', 'plugin.pinkie.lsp.message', 'plugin.pinkie.ext.progress', 'plugin.pinkie.ai.scan'];

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

  const offs = RELAYED.map((name) => host.onEvent(name, (payload) => {
    window.dispatchEvent(new CustomEvent('pinkie:gateway-event', {detail: {event: name, payload}}));
    if (name === 'sessions.changed') window.dispatchEvent(new CustomEvent('laolao:sessions-changed'));
  }));
  signal.addEventListener('abort', () => { for (const off of offs) off?.(); }, {once: true});
}
