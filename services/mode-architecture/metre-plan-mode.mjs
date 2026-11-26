// Metre「先出方案」（第五批 I4，对比-主流-Metre-1124.md 第 98 行）。
// 原生 OpenClaw 没有计划模式开关，这里只用碧琪插件层已有的钩子做，不动内核：
//   - pinkie.metre.planMode.get / set：按会话记开关（默认关，存在 <root>/plan-mode.json）；
//   - 开着时 before_prompt_build 加一段约束：先用 plan_update 写方案、停下等用户批，不动手；
//   - 开着时 before_tool_call 拦下改文件、跑命令、派活这几类工具，并说明为什么；读文件、写计划、问用户照常。
// 用户点「照这个方案做」= 界面先 set {on:false} 再发一句「照这个方案做。」（laolao-metre-perm.js）。
// 只管 Metre 会话（agent:metre:…），其他五个模式不受影响。
import fs from 'node:fs';
import path from 'node:path';

export const isMetreKey = (key) => /^agent:metre:/.test(String(key || ''));

// 先出方案时不让做的：改文件（和 artifacts.mjs 的 WRITE_TOOLS 同一组）、跑命令、派给外部引擎。
export const PLAN_BLOCKED_TOOLS = new Set(['write', 'edit', 'apply_patch', 'multi_edit', 'create', 'update',
  'exec', 'bash', 'process', 'pinkie_engine_task']);

export const PLAN_MODE_CONTEXT = '【先出方案】用户打开了「先出方案」：这一轮先不要动手。'
  + '先把要做的事看清楚（可以读文件、搜索），然后用 plan_update 写出方案（每一步一句话），'
  + '再用一两句话告诉用户方案要点，停下来等用户点「照这个方案做」。'
  + '在用户批准之前，不要改文件、不要跑命令、不要派活给别的引擎。';

export const PLAN_BLOCK_REASON = '现在是「先出方案」：用户批准方案之前不改文件、不跑命令、不派活。'
  + '请先用 plan_update 写出方案，告诉用户要点，等用户点「照这个方案做」。';

export function createPlanModeStore(root) {
  const file = root ? path.join(root, 'plan-mode.json') : '';
  let on = new Set();
  try { if (file) on = new Set(JSON.parse(fs.readFileSync(file, 'utf8')).on || []); } catch {}
  const save = () => {
    if (!file) return;
    fs.mkdirSync(root, {recursive: true});
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({on: [...on]}));
    fs.renameSync(tmp, file);
  };
  return {
    get: (key) => on.has(String(key || '')),
    set(key, value) {
      key = String(key || '');
      if (!isMetreKey(key)) throw new Error('只有 Metre 会话能开「先出方案」');
      const before = on.has(key);
      if (value) on.add(key); else on.delete(key);
      if (before !== Boolean(value)) save();
      return on.has(key);
    },
  };
}

export function registerMetrePlanMode(api, {root, isLocked = () => false} = {}) {
  const store = createPlanModeStore(root);
  const method = (name, scope, fn) => api.registerGatewayMethod?.(name, async ({params, respond}) => {
    try { respond(true, await fn(params || {})); }
    catch (error) { respond(false, undefined, {code: 'INVALID_REQUEST', message: String(error?.message || error)}); }
  }, {scope});
  method('pinkie.metre.planMode.get', 'operator.read', (p) => ({sessionKey: String(p.sessionKey || ''), on: store.get(p.sessionKey)}));
  method('pinkie.metre.planMode.set', 'operator.admin', (p) => ({sessionKey: String(p.sessionKey || ''), on: store.set(p.sessionKey, p.on === true)}));

  const active = (ctx) => {
    const key = String(ctx?.sessionKey || '');
    return isMetreKey(key) && !isLocked(key) && store.get(key);
  };
  api.on?.('before_prompt_build', (_event, ctx) => (active(ctx) ? {appendSystemContext: `\n${PLAN_MODE_CONTEXT}\n`} : undefined), {priority: -10860});
  api.on?.('before_tool_call', (event, ctx) => {
    if (!active(ctx)) return undefined;
    const name = String(event?.toolName || event?.name || '');
    return PLAN_BLOCKED_TOOLS.has(name) ? {block: true, blockReason: PLAN_BLOCK_REASON} : undefined;
  }, {priority: -10860});
  return store;
}
