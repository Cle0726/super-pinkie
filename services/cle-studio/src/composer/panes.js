// Each chat pane carries the room of its own session, not the page's.
//
// `html[data-cle-room]` is the room of the sidebar selector — a page-level value. In 双模式 two
// panes can sit in different rooms, so anything that changes per room (type size, learning
// spacing) must read the pane, not the page. The pane already knows its session key
// (`sessionKey`, `data-mcp-app-owner-key`, or an inner pane); the agent segment of that key is
// the room that pane is really in.
const AGENT_ROOM = {
  main: 'chat',
  project: 'project',
  thinking: 'thinking',
  learning: 'learning',
  unrestricted: 'unrestricted',
};

export function paneSessionKey(pane) {
  if (!pane) return '';
  const direct = pane.sessionKey || pane.dataset?.sessionKey || '';
  if (direct) return String(direct);
  try {
    const owner = JSON.parse(pane.dataset?.mcpAppOwnerKey || 'null');
    if (Array.isArray(owner) && owner[1]) return String(owner[1]);
  } catch { /* not an owner-marked pane */ }
  return String(pane.querySelector?.('openclaw-chat-pane')?.sessionKey || '');
}

export function roomOfSession(sessionKey) {
  const agent = (String(sessionKey || '').match(/^agent:([^:]+):/) || [])[1];
  return AGENT_ROOM[agent] || '';
}

// Stamp `data-cle-pane-room` on every pane. Cheap and idempotent: the attribute is only written
// when it changes, so the observer that calls us is not fed by our own writes.
export function markPaneRooms() {
  const panes = document.querySelectorAll('openclaw-chat-pane.chat-pane-cache__pane');
  for (const pane of panes) {
    const room = roomOfSession(paneSessionKey(pane));
    if (room) {
      if (pane.dataset.clePaneRoom !== room) pane.dataset.clePaneRoom = room;
    } else if ('clePaneRoom' in pane.dataset) {
      delete pane.dataset.clePaneRoom;
    }
  }
  return panes.length;
}

export function mountPaneRooms(signal) {
  markPaneRooms();
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; markPaneRooms(); });
  };
  const mo = new MutationObserver(schedule);
  // session keys arrive as attributes on the pane, so watch those too
  mo.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'session-key', 'data-mcp-app-owner-key', 'data-cle-pane-room'],
  });
  signal?.addEventListener('abort', () => mo.disconnect(), {once: true});
  return () => mo.disconnect();
}
