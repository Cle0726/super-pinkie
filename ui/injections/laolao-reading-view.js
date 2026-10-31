/* Only additional chat panes in the same document are reading views.
 * Mode dual-open uses independent documents: each keeps its own full UI.
 * Preserve the primary pane and its draft when panes are replaced or promoted. */
(() => {
  'use strict';
  if (window.__pinkieReadingViews) return;
  let primary = null, frame = 0;
  function isReading(pane) {
    const panes = [...document.querySelectorAll('openclaw-chat-pane')];
    const owner = panes.includes(primary) ? primary : panes[0];
    return panes.length > 1 && panes.includes(pane) && pane !== owner;
  }
  function refresh() {
    frame = 0;
    const panes = [...document.querySelectorAll('openclaw-chat-pane')];
    const previous = primary;
    primary = panes.includes(primary) ? primary : panes[0] || null;
    for (const pane of panes) {
      const on = isReading(pane);
      if (on !== pane.hasAttribute('data-pinkie-reading-view')) pane.toggleAttribute('data-pinkie-reading-view',on);
    }
    document.documentElement.setAttribute('data-pinkie-reading-ready','1');
    const before = previous?.state, after = primary?.state;
    if (previous && primary && previous !== primary && before && after
      && before.sessionKey === after.sessionKey && typeof before.chatMessage === 'string'
      && after.chatMessage !== before.chatMessage) {
      after.handleChatDraftChange?.(before.chatMessage);
      primary.requestUpdate?.();
    }
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(refresh); };
  new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes,...record.removedNodes]
      .some(node => node.nodeType===1 && (node.matches?.('openclaw-chat-pane') || node.querySelector?.('openclaw-chat-pane'))))) schedule();
  }).observe(document.documentElement,{childList:true,subtree:true});
  window.__pinkieReadingViews = {isReading,refresh};
  refresh();
})();
