// OpenClaw 2026.10 起的运行时路径与配置格式。
//
// 1. 状态目录不再固定是 ~/.openclaw：`--profile <名字>` 会把它变成 ~/.openclaw-<名字>，
//    OpenClaw 自己解析成 OPENCLAW_STATE_DIR / OPENCLAW_CONFIG_PATH 交给插件。
//    所以插件里所有「~/.openclaw/...」都必须走这里的函数。
// 2. agents.list（数组）改成了 agents.entries（对象，key 就是 agent id，值里没有 id 字段）。
//    两个都读，新格式优先。
//
// 这里的函数都支持注入 env / home，方便测试；生产里直接调用即可。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function homeDir(home) {
  return String(home || os.homedir());
}

// 展开 ~ / ~/x（Windows 下也认 ~\x）。空值原样返回。
export function expandHome(value, home = os.homedir()) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (raw === '~') return homeDir(home);
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return path.join(homeDir(home), raw.slice(2));
  return raw;
}

// OPENCLAW_STATE_DIR → 有 OPENCLAW_PROFILE 时 ~/.openclaw-<profile> → ~/.openclaw
export function openclawStateDir(env = process.env, home = os.homedir()) {
  const explicit = String(env?.OPENCLAW_STATE_DIR || '').trim();
  if (explicit) return path.resolve(expandHome(explicit, home));
  const profile = String(env?.OPENCLAW_PROFILE || '').trim().replace(/[\\/]+/g, '');
  if (profile) return path.join(homeDir(home), `.openclaw-${profile}`);
  return path.join(homeDir(home), '.openclaw');
}

// OPENCLAW_CONFIG_PATH → <stateDir>/openclaw.json
export function openclawConfigPath(options = {}) {
  const env = options.env || process.env;
  const home = options.home || os.homedir();
  const explicit = String(env?.OPENCLAW_CONFIG_PATH || '').trim();
  if (explicit) return path.resolve(expandHome(explicit, home));
  return path.join(openclawStateDir(env, home), 'openclaw.json');
}

// 旧格式 agents.list 每项自带 id；新格式 agents.entries 的 key 就是 id。
export function agentEntries(config = {}) {
  const agents = config?.agents || {};
  const entries = agents.entries;
  if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
    const result = [];
    const seen = new Set();
    for (const [key, value] of Object.entries(entries)) {
      if (!value || typeof value !== 'object') continue;
      const id = String(value.id || key || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      result.push({...value, id});
    }
    return result;
  }
  const list = Array.isArray(agents.list) ? agents.list : [];
  const result = [];
  const seen = new Set();
  for (const value of list) {
    if (!value || typeof value !== 'object') continue;
    const id = String(value.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push({...value, id});
  }
  return result;
}

export function findAgent(config, id) {
  const wanted = String(id || '').trim();
  if (!wanted) return null;
  return agentEntries(config).find(entry => entry.id === wanted) || null;
}

// agent 自己的 workspace → <stateDir>/workspace（main）/ <stateDir>/workspace-<id> → agents.defaults.workspace
export function agentWorkspace(config, id, options = {}) {
  const env = options.env || process.env;
  const home = options.home || os.homedir();
  const agentId = String(id || 'main').trim() || 'main';
  const entry = findAgent(config, agentId);
  const own = expandHome(entry?.workspace, home);
  if (own && path.isAbsolute(own)) return own;
  const stateDir = openclawStateDir(env, home);
  const derived = path.join(stateDir, agentId === 'main' ? 'workspace' : `workspace-${agentId}`);
  // main 的缺省位置就是 <stateDir>/workspace；其它 agent 没配置时看 agents.defaults.workspace。
  if (agentId === 'main') return derived;
  const fallback = expandHome(config?.agents?.defaults?.workspace, home);
  if (fallback && path.isAbsolute(fallback)) return fallback;
  return derived;
}

// 插件 API 给的配置优先（api.runtime.config.current() → api.config），读文件只做兜底。
export function runtimeConfig(api, options = {}) {
  try {
    const value = api?.runtime?.config?.current?.({});
    if (value && typeof value === 'object') return value;
  } catch { /* 继续找 */ }
  try {
    const direct = api?.config;
    if (typeof direct === 'function') {
      const value = direct();
      if (value && typeof value === 'object') return value;
    } else if (direct && typeof direct === 'object') {
      // 有些宿主给的是载入上下文里的 {config, agentId, ...}
      if (direct.config && typeof direct.config === 'object' && !Array.isArray(direct.config.agents)) return direct.config;
      return direct;
    }
  } catch { /* 继续兜底 */ }
  const {allowFile = true, ...rest} = options;
  return allowFile ? readConfigFile(rest) : {};
}

function optionsFrom(options = {}) {
  return {env: options.env || process.env, home: options.home || os.homedir()};
}

export function readConfigFile(options = {}) {
  const {env, home} = optionsFrom(options);
  try {
    return JSON.parse(fs.readFileSync(openclawConfigPath({env, home}), 'utf8')) || {};
  } catch {
    return {};
  }
}

// OpenClaw 的可执行文件/依赖目录（agent-env）。profile 状态目录里通常没有它，所以：
// <stateDir>/agent-env/... 存在就用；否则退回主目录的 ~/.openclaw/agent-env/...（同样存在才返回）。
export function openclawAgentEnvPath(...segments) {
  const primary = path.join(openclawStateDir(), 'agent-env', ...segments);
  try { if (fs.existsSync(primary)) return primary; } catch { /* 继续退回 */ }
  const legacy = path.join(homeDir(os.homedir()), '.openclaw', 'agent-env', ...segments);
  try { if (fs.existsSync(legacy)) return legacy; } catch { /* 不存在 */ }
  return primary;
}
