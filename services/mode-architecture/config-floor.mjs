// 手册长度上限的自动保障：OpenClaw 默认把每份手册截到 2 万字（静默截掉中间一段），项目手册已经超过这个数。
// 以前只有安装脚本 setup.py 会把上限抬高；用户大多零基础，不会、也不该去跑脚本，而有的更新路径只换文件不跑它。
// 所以引擎自己在网关启动时看一眼配置：上限不够就抬到位，够了就什么都不动。只抬不降，只碰这两个键，
// 写之前留一份备份，写的时候先写临时文件再改名（不会留下写了一半的配置）。
import fs from 'node:fs';
import path from 'node:path';

export const MANUAL_FLOORS = Object.freeze({bootstrapMaxChars: 60_000, bootstrapTotalMaxChars: 200_000});

export function ensureManualLimits(configPath, {log = () => {}} = {}) {
  let raw;
  try { raw = fs.readFileSync(configPath, 'utf8'); } catch { return {changed: false, reason: 'no-config'}; }
  let data;
  // 解析不了（用户手改坏了、或者带注释）就不碰，交给 App 的配置修复去处理。
  try { data = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { return {changed: false, reason: 'unparsable'}; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {changed: false, reason: 'unexpected-shape'};
  const agents = data.agents;
  if (agents != null && (typeof agents !== 'object' || Array.isArray(agents))) return {changed: false, reason: 'unexpected-shape'};
  const defaults = agents?.defaults;
  if (defaults != null && (typeof defaults !== 'object' || Array.isArray(defaults))) return {changed: false, reason: 'unexpected-shape'};
  const raised = [];
  const next = {...(defaults || {})};
  for (const [key, floor] of Object.entries(MANUAL_FLOORS)) {
    const current = next[key];
    if (typeof current !== 'number' || !Number.isInteger(current) || current < floor) { next[key] = floor; raised.push(key); }
  }
  if (!raised.length) return {changed: false, reason: 'ok'};
  const updated = {...data, agents: {...(agents || {}), defaults: next}};
  try {
    const backup = `${configPath}.before-manual-limit`;
    if (!fs.existsSync(backup)) fs.copyFileSync(configPath, backup);
    const tmp = path.join(path.dirname(configPath), `.${path.basename(configPath)}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, `${JSON.stringify(updated, null, 2)}\n`, {mode: 0o600});
    fs.renameSync(tmp, configPath);
  } catch (error) {
    log(`manual limit: could not update the config: ${error?.message || error}`);
    return {changed: false, reason: 'write-failed'};
  }
  log(`manual limit: raised ${raised.join(', ')} so long manuals are not cut`);
  return {changed: true, raised};
}
