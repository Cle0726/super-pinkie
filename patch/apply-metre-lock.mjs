// 正式版 Metre 密码门槛（网关入口兜底）：
// 在 OpenClaw 网关 handleGatewayRequest 处统一拦截还没解锁时的 agent:metre: / agentId=metre 请求
// （chat.send、sessions.create、sessions.send、sessions.steer、agent、chat.inject、cron.add 等），
// 让直接发向网关的请求当场被拒，不进队列、不写记录、不起模型；
// 即使 mode-architecture 插件在正式版里意外没加载，也能按包内 build-info.json / guard-build.json 保守拒进（fail-closed）。
export function transformWithStatus(source) {
  const marker = '/* pinkie-metre-lock:v2 */';
  if (source.includes(marker)) return {changed: false, reason: 'already-patched', text: source};
  if (!source.includes('async function handleGatewayRequest(') || !source.includes('authorizeGatewayMethod(')) {
    return {changed: false, reason: 'unsupported-runtime', text: source};
  }
  const anchor = '\tif (authError) {\n\t\trespond(false, void 0, authError);\n\t\treturn;\n\t}';
  let working = source;
  // 若已打过旧版 v1 补丁，先还原锚点再升级到 v2。
  const oldV1 = `${anchor}\n\t/* pinkie-metre-lock:v1 */\n\tconst metreGate = globalThis[Symbol.for("pinkie.metreLock.v1")];\n\tconst metreBlock = metreGate?.checkGatewayRequest?.(req.method, req.params);\n\tif (metreBlock) {\n\t\trespond(false, void 0, errorShape(ErrorCodes.INVALID_REQUEST, metreBlock));\n\t\treturn;\n\t}`;
  if (working.includes(oldV1)) working = working.replace(oldV1, anchor);
  if (working.split(anchor).length !== 2) {
    return {changed: false, reason: 'missing-anchor', text: source};
  }
  const injection = `${anchor}
\t${marker}
\tconst metreGate = globalThis[Symbol.for("pinkie.metreLock.v1")];
\tlet metreBlock = metreGate?.checkGatewayRequest?.(req.method, req.params);
\tif (!metreGate && !metreBlock) {
\t\tconst releaseCheckKey = Symbol.for("pinkie.metreLock.releaseRuntime.v1");
\t\tif (globalThis[releaseCheckKey] === void 0) {
\t\t\tlet isRelease = false;
\t\t\ttry {
\t\t\t\tconst fsMod = process.getBuiltinModule?.("node:fs");
\t\t\t\tconst pathMod = process.getBuiltinModule?.("node:path");
\t\t\t\tconst urlMod = process.getBuiltinModule?.("node:url");
\t\t\t\tconst osMod = process.getBuiltinModule?.("node:os");
\t\t\t\tif (fsMod && pathMod && urlMod) {
\t\t\t\t\tconst here = pathMod.dirname(urlMod.fileURLToPath(import.meta.url));
\t\t\t\t\tconst stateDir = process.env.OPENCLAW_STATE_DIR || (osMod ? pathMod.join(osMod.homedir(), ".openclaw") : "");
\t\t\t\t\tconst candidates = [
\t\t\t\t\t\tpathMod.resolve(here, "../../../build-info.json"),
\t\t\t\t\t\tpathMod.resolve(here, "../../../../build-info.json"),
\t\t\t\t\t\t...(stateDir ? [pathMod.join(stateDir, "extensions", "pinkie-mode-architecture", "guard-build.json")] : []),
\t\t\t\t\t];
\t\t\t\t\tfor (const candidate of candidates) {
\t\t\t\t\t\ttry {
\t\t\t\t\t\t\tconst info = JSON.parse(fsMod.readFileSync(candidate, "utf8"));
\t\t\t\t\t\t\tif (info && (info.channel === "release" || info.guard === true)) { isRelease = true; break; }
\t\t\t\t\t\t} catch {}
\t\t\t\t\t}
\t\t\t\t}
\t\t\t} catch {}
\t\t\tglobalThis[releaseCheckKey] = isRelease;
\t\t}
\t\tif (globalThis[releaseCheckKey] === true) {
\t\t\tconst m = String(req.method || "").trim();
\t\t\tconst p = req.params && typeof req.params === "object" ? req.params : {};
\t\t\tconst isMetreKey = (v) => /^agent:metre(?::|$)/i.test(String(v ?? "").trim());
\t\t\tconst hasMetre = (obj, d = 0) => {
\t\t\t\tif (!obj || typeof obj !== "object" || d > 4) return false;
\t\t\t\tif (Array.isArray(obj)) return obj.some((x) => typeof x === "string" ? isMetreKey(x) : hasMetre(x, d + 1));
\t\t\t\tfor (const k of ["sessionKey", "key", "target", "session", "parentSessionKey", "targetSessionKey", "childSessionKey", "requesterSessionKey", "parentKey", "sourceKey", "fromKey", "from", "to", "sessionId", "id"]) {
\t\t\t\t\tif (isMetreKey(obj[k])) return true;
\t\t\t\t}
\t\t\t\tif (String(obj.agentId ?? "").trim().toLowerCase() === "metre" || String(obj.agent ?? "").trim().toLowerCase() === "metre" || String(obj.mode ?? "").trim().toLowerCase() === "metre") return true;
\t\t\t\tfor (const [k, v] of Object.entries(obj)) {
\t\t\t\t\tif (k === "message" || k === "content" || k === "prompt" || k === "text" || k === "body" || k === "plan" || k === "query") continue;
\t\t\t\t\tif (v && typeof v === "object" && hasMetre(v, d + 1)) return true;
\t\t\t\t}
\t\t\t\treturn false;
\t\t\t};
\t\t\tconst allowToday = m === "pinkie.metre.today" && !p.sessionKey && !p.folder && !p.scope && !hasMetre(p);
\t\t\tconst allowGuard = m === "pinkie.guard.status" || m === "pinkie.guard.metreStatus" || m === "pinkie.guard.metreUnlock" || m === "pinkie.guard.metreLock";
\t\t\tif (!allowGuard && !allowToday && (m.startsWith("pinkie.metre.") || (m.startsWith("agents.") && String(p.id ?? "").trim().toLowerCase() === "metre") || (m === "pinkie.quiet.set" && p.quiet === true) || hasMetre(p))) {
\t\t\t\tmetreBlock = "正式版中 Metre 需要先输入开发者密码解锁。";
\t\t\t}
\t\t}
\t}
\tif (metreBlock) {
\t\trespond(false, void 0, errorShape(ErrorCodes.INVALID_REQUEST, metreBlock));
\t\treturn;
\t}`;
  return {changed: true, reason: 'patched', text: working.replace(anchor, injection)};
}

// CLI: OPENCLAW_ROOT=<openclaw package> node patch/apply-metre-lock.mjs
import {applyDist as pinkieApplyDist} from './lib-apply-dist.mjs';
import {fileURLToPath as pinkieFileURL} from 'node:url';
import pinkiePath from 'node:path';
if (process.argv[1] && pinkiePath.resolve(process.argv[1]) === pinkieFileURL(import.meta.url)) {
  if (!process.env.OPENCLAW_ROOT) throw new Error('Set OPENCLAW_ROOT to the active OpenClaw package');
  console.log(JSON.stringify(pinkieApplyDist(process.env.OPENCLAW_ROOT, 'metre-lock', [transformWithStatus])));
}
