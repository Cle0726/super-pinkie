// Recognize the optimistic UI copy by the actual send run ID. This does not
// collapse distinct user sends that happen to contain the same text.
export function pinkieReconcileOptimisticUser(messages, options) {
  if (!Array.isArray(messages) || !/^agent:(?:main|project|thinking|learning):/.test(String(options?.sessionKey || ''))) return messages;
  const pane = pinkieHistoryPane(options), state = pane?.state;
  if (!state || state.sessionKey !== options.sessionKey || state.chatMessages !== messages) return messages;
  const text = m => typeof m.content === 'string' ? m.content : Array.isArray(m.content)
    ? m.content.filter(x => x && typeof x.text === 'string').map(x => x.text).join('') : '';
  const hasAttachment = m => Boolean(m?.MediaPath || m?.MediaPaths?.length)
    || (Array.isArray(m?.content) && m.content.some(x => x && !['text','input_text','output_text'].includes(x.type)));
  const saved = new Map();
  for (const m of messages) {
    const key = m?.__openclaw?.idempotencyKey;
    if (String(m?.role || '').toLowerCase() === 'user' && m?.__openclaw?.id && typeof key === 'string' && key.endsWith(':user')) saved.set(key.slice(0, -5), m);
  }
  const remove = new Set();
  for (const m of messages) {
    const run = m?.__pinkieOptimisticRunId, durable = typeof run === 'string' && saved.get(run);
    if (durable && String(m.role || '').toLowerCase() === 'user' && !m.__openclaw?.id
      && !hasAttachment(m) && !hasAttachment(durable) && text(m) === text(durable)) remove.add(m);
  }
  if (!remove.size) return messages;
  const result = messages.filter(m => !remove.has(m));
  state.chatMessages = result;
  return result;
}

export function transformWithStatus(original) {
  const marker = '/* pinkie-optimistic-user-reconcile:v1 */';
  const fn = 'function Vh(e,t,n,r=Date.now()){let i={role:`user`,content:Dh(t,n),timestamp:r};return e.chatMessages=[...e.chatMessages,i],i}';
  const call = 'if(Vh(e,o,c?s:void 0,d),r.status===`ok`)';
  const select = 'r=pinkieSelectMessageWindow(e.messages,Li,e),';
  const runtime = '/* pinkie-chat-timeline:v26 */function userText';
  if (original.includes(marker)) return {changed:false,reason:'already-patched',text:original};
  if ([fn,call,select,runtime].some(x => original.split(x).length !== 2)) return {changed:false,reason:'unsupported-ui',text:original};
  const tagged = 'function Vh(e,t,n,r=Date.now(),runId){let i={role:`user`,content:Dh(t,n),timestamp:r};if(/^agent:(?:main|project|thinking|learning):/.test(String(e.sessionKey||""))&&typeof runId==="string")i.__pinkieOptimisticRunId=runId;return e.chatMessages=[...e.chatMessages,i],i}';
  const text = original.replace(fn,tagged).replace(call,'if(Vh(e,o,c?s:void 0,d,r.runId),r.status===`ok`)')
    .replace(select,'r=pinkieSelectMessageWindow(pinkieReconcileOptimisticUser(e.messages,e),Li,e),')
    .replace(runtime,`${marker}${pinkieReconcileOptimisticUser.toString()}\n${runtime}`);
  return {changed:true,reason:'patched',text};
}
