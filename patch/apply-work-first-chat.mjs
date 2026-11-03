import {transformWithStatus as optimistic} from './apply-optimistic-user-reconcile.mjs';

// A gateway attachment mirror replaces only its immediately preceding native
// final. Keep distinct turns, attachments, and differently worded answers intact.
export function workFirstDeliveryMessages(messages, options) {
  if (!Array.isArray(messages) || !/^agent:(?:main|project|thinking|learning):/.test(String(options?.sessionKey || ''))
      || /:(?:subagent|internal-session-effects|cron|heartbeat):/.test(options.sessionKey)) return messages;
  const text = m => (typeof m?.content === 'string' ? m.content : (m?.content || [])
    .filter(p => p?.type === 'text').map(p => p.text || '').join('\n'))
    .replace(/^\s*MEDIA:[^\r\n]*$/gim, '').replace(/\s+/g, '').trim();
  const output = [];
  for (const message of messages) {
    const prior = output.at(-1);
    const key = message?.idempotencyKey || message?.__openclaw?.idempotencyKey;
    const mirror = message?.role === 'assistant' && message?.provider === 'openclaw'
      && message?.model === 'gateway-injected' && typeof key === 'string' && key.endsWith(':assistant-media');
    const now = Number(message?.timestamp || message?.__openclaw?.recordTimestampMs || 0);
    const before = Number(prior?.__openclaw?.recordTimestampMs || prior?.timestamp || 0);
    if (mirror && prior?.role === 'assistant' && prior?.provider !== 'openclaw'
        && /^(?:stop|end_turn)$/.test(prior?.stopReason || '') && now > 0 && before > 0
        && now >= before && now - before < 120_000 && text(prior) && text(prior) === text(message)) output.pop();
    output.push(message);
  }
  return output.length === messages.length ? messages : output;
}

export function transformWithStatus(source) {
  const marker = '/* pinkie-work-first-chat:v1 */';
  if (source.includes(marker)) return {changed: false, reason: 'already-patched', text: source};
  const first = optimistic(source);
  if (!first.changed && first.reason !== 'already-patched') return first;
  const anchor = 'r=pinkieSelectMessageWindow(pinkieReconcileOptimisticUser(e.messages,e),Li,e),';
  if (first.text.split(anchor).length !== 2) return {changed: false, reason: 'unsupported-ui', text: source};
  return {changed: true, reason: 'patched', text: `${marker}\n${workFirstDeliveryMessages.toString()}\n` + first.text.replace(anchor,
    'r=pinkieSelectMessageWindow(workFirstDeliveryMessages(pinkieReconcileOptimisticUser(e.messages,e),e),Li,e),')};
}
