// Media-bearing finals bypass the model transcript hook on the pinned runtime.
// Recheck the delivery decision before a gateway mirror can expose a rejected draft.
export function workFirstMediaPayload(payload, info, sessionKey, agentId, beforeWrite) {
  if (!['final', 'block'].includes(info?.kind) || !/^agent:(?:main|project|thinking|learning):/.test(String(sessionKey || ''))
      || /:(?:subagent|internal-session-effects|cron|heartbeat):/.test(sessionKey)) return payload;
  const message = beforeWrite({agentId, sessionKey, message: {
    role: 'assistant', stopReason: 'stop', __pinkieDeliveryMirror: true,
    content: [{type: 'text', text: String(payload?.text || '')}],
  }});
  if (!message) return null;
  const text = typeof message.content === 'string' ? message.content
    : message.content?.filter(part => part?.type === 'text').map(part => part.text || '').join('\n');
  return typeof text === 'string' && text !== String(payload?.text || '') ? {...payload, text} : payload;
}

export function transformWithStatus(source) {
  const marker = '/* pinkie-work-first-media-gate:v2 */';
  if (source.includes(marker)) return {changed: false, reason: 'already-patched', text: source};
  const previous = workFirstMediaPayload.toString().replace("if (!['final', 'block'].includes(info?.kind) ||", "if (info?.kind !== 'final' ||");
  const prefix = '/* pinkie-work-first-media-gate:v1 */\n' + previous + '\n';
  if (source.startsWith(prefix)) return {changed:true,reason:'upgraded',text:marker+'\n'+workFirstMediaPayload.toString()+'\n'+source.slice(prefix.length)};
  if (source.includes('/* pinkie-work-first-media-gate:v1 */')) return {changed:false,reason:'modified-prior-patch',text:source};
  const anchor = '\t\t\t\tdeliver: async (payload, info) => {\n\t\t\t\t\tif (getReplyPayloadMetadata(payload)?.beforeAgentRunBlocked === true) userTurnRecorder.markBlocked();';
  if (source.split(anchor).length !== 2 || !source.includes('const appendWebchatAgentMediaTranscriptIfNeeded = async (payload) => {')
      || !source.includes('runAgentHarnessBeforeMessageWriteHook')) return {changed: false, reason: 'unsupported-runtime', text: source};
  const replacement = anchor + '\n\t\t\t\t\tpayload = workFirstMediaPayload(payload, info, sessionKey, agentId, runAgentHarnessBeforeMessageWriteHook);\n\t\t\t\t\tif (!payload) return;';
  return {changed: true, reason: 'patched', text: `${marker}\n${workFirstMediaPayload.toString()}\n` + source.replace(anchor, replacement)};
}
