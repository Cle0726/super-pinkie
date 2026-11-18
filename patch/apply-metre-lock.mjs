// 正式版 Metre 密码门槛（网关入口兜底）：
// 在 OpenClaw 网关 handleGatewayRequest 处统一拦截还没解锁时的 agent:metre: / agentId=metre 请求
// （chat.send、sessions.create、sessions.send、sessions.steer、agent、chat.inject 等），
// 让直接发向网关的请求当场被拒，不进队列、不写记录、不起模型。
export function transformWithStatus(source) {
  const marker = '/* pinkie-metre-lock:v1 */';
  if (source.includes(marker)) return {changed: false, reason: 'already-patched', text: source};
  if (!source.includes('async function handleGatewayRequest(') || !source.includes('authorizeGatewayMethod(')) {
    return {changed: false, reason: 'unsupported-runtime', text: source};
  }
  const anchor = '\tif (authError) {\n\t\trespond(false, void 0, authError);\n\t\treturn;\n\t}';
  if (source.split(anchor).length !== 2) {
    return {changed: false, reason: 'missing-anchor', text: source};
  }
  const injection = `${anchor}
\t${marker}
\tconst metreGate = globalThis[Symbol.for("pinkie.metreLock.v1")];
\tconst metreBlock = metreGate?.checkGatewayRequest?.(req.method, req.params);
\tif (metreBlock) {
\t\trespond(false, void 0, errorShape(ErrorCodes.INVALID_REQUEST, metreBlock));
\t\treturn;
\t}`;
  return {changed: true, reason: 'patched', text: source.replace(anchor, injection)};
}

// CLI: OPENCLAW_ROOT=<openclaw package> node patch/apply-metre-lock.mjs
import {applyDist as pinkieApplyDist} from './lib-apply-dist.mjs';
import {fileURLToPath as pinkieFileURL} from 'node:url';
import pinkiePath from 'node:path';
if (process.argv[1] && pinkiePath.resolve(process.argv[1]) === pinkieFileURL(import.meta.url)) {
  if (!process.env.OPENCLAW_ROOT) throw new Error('Set OPENCLAW_ROOT to the active OpenClaw package');
  console.log(JSON.stringify(pinkieApplyDist(process.env.OPENCLAW_ROOT, 'metre-lock', [transformWithStatus])));
}
