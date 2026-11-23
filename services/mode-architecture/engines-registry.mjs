// Metre「更多引擎」（PLAN 3.7 末段、分批 E6）：引擎服务能从公开的 ACP 注册表里加别家的编程引擎（Devin、Gemini CLI、Qwen Code……）。
// 只用引擎服务自己设置页用的三条命令：server.searchAcpRegistry（搜）、server.prepareAcpRegistryAgent（下载、准备），
// server.updateSettings 的 providerInstanceMutation（建一个 driver 为 acpRegistry、config 为 {agentId} 的实例）。
// 加好以后它就是引擎菜单里普通的一行：登录（provider.auth.*）、选模型、派活、删掉都走 engines-bridge.mjs 现成的路。
// 注册表里的引擎是第三方代码：列表里写清楚许可证、来源和怎么装，用户点了「加上」才下载；碧琪不经手它们的账号。
import {REGISTRY_DRIVER, brandless} from './engines-bridge.mjs';

// 菜单里已经有的十家不在这里重复列（引擎服务自己的设置页也这么做：各家 client.ts 的 acpRegistryAgentIds）。
// muse-code 是 Muse Code 在注册表里的那一份，十家里已经有了。
export const FIRST_CLASS = new Set(['codex-acp', 'claude-acp', 'antigravity-acp', 'cursor', 'grok-build', 'opencode', 'opencode-v2', 'pi-acp', 'muse-code']);
const AGENT_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const HOW = {binary: '下载运行包', npx: '用 npm 装', uvx: '用 Python 工具装'};
const web = url => /^https:\/\/[^\s"'<>]+$/i.test(String(url || '')) ? String(url).slice(0, 2048) : '';
const text = (value, n) => brandless(String(value ?? '')).replace(/\s+/g, ' ').trim().slice(0, n);

// 注册表的一条 → 菜单里的一行。不要图标：图在别人的网站上，界面不去外网取图。
export function agentView(agent, added = new Set()) {
  const id = String(agent?.id || '');
  if (!AGENT_ID.test(id)) return null;
  return {id, name: text(agent.name, 80) || id, version: text(agent.version, 40), description: text(agent.description, 200), license: text(agent.license, 60),
    link: web(agent.website) || web(agent.repository), dist: HOW[agent.distribution] ? String(agent.distribution) : '', how: HOW[agent.distribution] || '',
    checked: agent.integrity === 'sha256', added: added.has(id)};
}

// 实例 id 照引擎服务设置页的规矩：driver_名字（小写字母数字下划线，最长 64），重名加 _2、_3。
export function instanceIdFor(agentId, taken = new Set()) {
  const slug = String(agentId || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'agent';
  const base = `${REGISTRY_DRIVER}_${slug}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) { const id = `${base.slice(0, 63 - String(n).length)}_${n}`; if (!taken.has(id)) return id; }
}

export class EngineRegistry {
  constructor(bridge) { this.bridge = bridge; }

  async instances() { return (await this.bridge.settings())?.providerInstances || {}; }

  // 已经加过的（照引擎服务设置页：同一家只加一次；本机命令那种不算）。
  added(instances) {
    return new Set(Object.values(instances || {}).filter(item => item?.driver === REGISTRY_DRIVER && item.config?.source !== 'local')
      .map(item => String(item.config?.agentId || '')).filter(Boolean));
  }

  async lookup(query = '') {
    const q = String(query || '').trim().slice(0, 120);
    const result = await this.bridge.call('server.searchAcpRegistry', q ? {query: q} : {query: '', limit: 512}, {timeout: 60_000});
    return {q, agents: (Array.isArray(result?.agents) ? result.agents : []).filter(agent => !FIRST_CLASS.has(String(agent?.id)))};
  }

  async search({query = ''} = {}) {
    const {q, agents} = await this.lookup(query);
    const added = this.added(await this.instances().catch(() => ({})));
    return {query: q, agents: agents.map(agent => agentView(agent, added)).filter(Boolean)};
  }

  // 加上：先让引擎服务下载、准备（运行包有 sha256 就核对），再建实例，让它查一遍这一家。
  async add({agentId} = {}) {
    const id = String(agentId || '');
    if (!AGENT_ID.test(id) || FIRST_CLASS.has(id)) throw new Error('不认识这个引擎');
    const found = (await this.lookup('')).agents.find(agent => agent?.id === id);
    if (!found) throw new Error('注册表里没有找到它，可能已经下架了');
    const instances = await this.instances();
    if (this.added(instances).has(id)) throw new Error('已经加过了');
    await this.bridge.call('server.prepareAcpRegistryAgent', {agentId: id}, {timeout: 15 * 60_000});
    const engine = instanceIdFor(id, new Set(Object.keys(instances)));
    await this.bridge.call('server.updateSettings', {patch: {}, providerInstanceMutation: {operation: 'create', instanceId: engine,
      instance: {driver: REGISTRY_DRIVER, enabled: true, displayName: agentView(found).name, config: {agentId: id, distribution: 'auto'}}}});
    await this.bridge.refreshOne(engine);
    return {engine, ...await this.bridge.catalog()};
  }
}

// 网关方法 pinkie.engines.registry {action: 'search', query} / {action: 'add', agentId}。删掉走 pinkie.engines.account {action: 'remove'}。
export function registerEngineRegistry(api, {bridge, register, ensureRunning, status}) {
  const registry = new EngineRegistry(bridge);
  register(api, 'pinkie.engines.registry', async ({action = 'search', query, agentId} = {}) => {
    await ensureRunning();
    if (action === 'search') return registry.search({query});
    if (action === 'add') return {...status(), ...await registry.add({agentId})};
    throw new Error('不认识的动作');
  });
  return registry;
}
