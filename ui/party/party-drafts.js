/* Pure local draft helpers, shared with the offline regression tests. */
(() => {
  const prefix = 'pinkie.party.draft.v1.';
  const validRoom = id => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id);
  const normalize = value => ({
    text: typeof value?.text === 'string' ? value.text.slice(0, 12000) : '',
    recipient: ['pinkie', 'codex', 'openclaw'].includes(value?.recipient) ? value.recipient : 'pinkie',
    reply: Number.isSafeInteger(value?.reply?.id) && value.reply.id > 0 ? {
      id: value.reply.id,
      sender: typeof value.reply.sender === 'string' ? value.reply.sender : 'user',
      body: typeof value.reply.body === 'string' ? value.reply.body.slice(0, 200) : '',
    } : null,
  });
  const api = {
    read(storage, room) {
      if (!validRoom(room)) return normalize(null);
      try { return normalize(JSON.parse(storage.getItem(prefix + room))); }
      catch { return normalize(null); }
    },
    save(storage, room, value) {
      if (!validRoom(room)) return;
      const draft = normalize(value);
      if (!draft.text && !draft.reply) storage.removeItem(prefix + room);
      else storage.setItem(prefix + room, JSON.stringify(draft));
    },
    clearIfUnchanged(storage, room, sent) {
      const draft = api.read(storage, room);
      if (draft.text.trim() !== sent.text.trim() || draft.reply?.id !== (sent.reply || undefined) || draft.recipient !== sent.recipient) return false;
      storage.removeItem(prefix + room);
      return true;
    },
    requestId(storage, room, payload, createId) {
      if (!validRoom(room)) throw new Error('无效群聊');
      const key = prefix + 'request.' + room, signature = JSON.stringify(payload);
      let previous;
      try { previous = JSON.parse(storage.getItem(key)); } catch { /* first request */ }
      if (previous?.signature === signature && typeof previous.id === 'string') return previous.id;
      const id = createId();
      storage.setItem(key, JSON.stringify({signature, id}));
      return id;
    },
    acknowledge(storage, room, id) {
      const key = prefix + 'request.' + room;
      try { if (JSON.parse(storage.getItem(key))?.id === id) storage.removeItem(key); } catch { /* empty */ }
    },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.PartyDrafts = api;
})();
