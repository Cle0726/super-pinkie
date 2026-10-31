// Reuse the native queued item's reserved idempotency key for its steer RPC.
// A durable receipt can then identify this exact message, even when two user
// messages contain identical text. Other modes retain their existing path.
export function transformWithStatus(original) {
  const marker='/* pinkie-steer-identity:v1 */';
  if(original.includes(marker))return {changed:false,reason:'already-patched',text:original};
  const head='async function Hh(e,t,n){if(!e.client||!e.connected)return null;let r=t.trim(),i=n&&n.length>0;if(!r&&!i)return null;Oh(e,null);let a=v();';
  const forward='async function Wh(e,t,n){return Hh(e,t,n)}';
  const call='let s=await Wh(e,i,o?a:void 0);';
  if([head,forward,call].some(x=>original.split(x).length!==2))return {changed:false,reason:'unsupported-ui',text:original};
  const replacement=`${marker}async function Hh(e,t,n,requestedRunId){if(!e.client||!e.connected)return null;let r=t.trim(),i=n&&n.length>0;if(!r&&!i)return null;Oh(e,null);let a=typeof requestedRunId===\`string\`&&/^[\\w-]{8,100}$/.test(requestedRunId)?requestedRunId:v();`;
  const text=original.replace(head,replacement).replace(forward,'async function Wh(e,t,n,requestedRunId){return Hh(e,t,n,requestedRunId)}')
    .replace(call,'let s=await Wh(e,i,o?a:void 0,/^agent:(?:main|project|thinking|learning):/.test(String(e.sessionKey||""))?r.sendRunId:void 0);');
  return {changed:true,reason:'patched',text};
}
