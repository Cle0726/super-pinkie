// Keep ambiguous delivery explicit across UI, persistence and native draining.
// A different user instruction with the same text must not be merged or retried.
export function pinkieQueueUnconfirmed(item) {
  return item?.sendState === 'unconfirmed'
    && /^agent:(?:main|project|thinking|learning):/.test(String(item?.sessionKey || ''));
}

export function transformWithStatus(source) {
  const marker = '/* pinkie-queue-unconfirmed:v1 */';
  if (source.includes(marker)) return { changed: false, reason: 'already-patched', text: source };
  const changes = [
    ['function Ku(e){', `${marker}${pinkieQueueUnconfirmed.toString()}\nfunction Ku(e){`],
    ['if(!t||!n.trim()&&!e.attachments?.length||e.pendingRunId||e.sendState===`sending`)return null',
      'if(!t||!n.trim()&&!e.attachments?.length||e.pendingRunId&&!pinkieQueueUnconfirmed(e)||e.sendState===`sending`)return null'],
    ['let i=e.sendState===`failed`||e.sendState===`waiting-reconnect`||e.sendState===`waiting-model`?e.sendState:void 0',
      'let i=e.sendState===`failed`||e.sendState===`waiting-reconnect`||e.sendState===`waiting-model`||pinkieQueueUnconfirmed(e)?e.sendState:void 0'],
    ['...e.kind===`queued`||e.kind===`steered`?{kind:e.kind}:{},...r.length?{attachments:r}:{}',
      '...e.kind===`queued`||e.kind===`steered`?{kind:pinkieQueueUnconfirmed(e)?`queued`:e.kind}:{},...r.length?{attachments:r}:{}'],
    ['t.sendState===`failed`||t.sendState===`waiting-reconnect`?o.sendState=t.sendState',
      't.sendState===`failed`||t.sendState===`waiting-reconnect`||pinkieQueueUnconfirmed(t)?o.sendState=t.sendState'],
    ['case`failed`:return`Failed`;default:return null}}function Xv',
      'case`failed`:return`Failed`;case`unconfirmed`:return pinkieQueueUnconfirmed(e)?`送达未确认`:null;default:return null}}function Xv'],
    ['${t.sendState===`failed`&&e.onQueueRetry?',
      '${(t.sendState===`failed`||pinkieQueueUnconfirmed(t)&&!t.pendingRunId)&&e.onQueueRetry?'],
    ['t.sendState!==`sending`&&t.sendState!==`waiting-model`&&t.sendState!==`failed`&&(t.sessionKey==null||t.sessionKey===e.sessionKey)',
      't.sendState!==`sending`&&t.sendState!==`waiting-model`&&t.sendState!==`failed`&&!pinkieQueueUnconfirmed(t)&&(t.sessionKey==null||t.sessionKey===e.sessionKey)'],
  ];
  if (changes.some(([before]) => source.split(before).length !== 2)) {
    return { changed: false, reason: 'unsupported-ui', text: source };
  }
  return { changed: true, reason: 'patched', text: changes.reduce((value, [before, after]) => value.replace(before, after), source) };
}
