#!/usr/bin/env node
// 批 0 清点：把三个插件注册到一个假的 api 上，逐个调用 before_prompt_build 钩子，
// 记下每个钩子的来源文件、优先级、产出字数。不连网关、不调模型，状态目录和工作区都在临时目录里。
//
//   node tools/metre/inject-inventory.mjs [agentId ...]        # 默认 project metre
//   node tools/metre/inject-inventory.mjs --json project metre  # 机器可读
//
// 测试（tests/metre-inject.test.mjs）也用这里导出的 collect()。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PERSONA_DIR = {main: 'chat', project: 'project', thinking: 'thinking', learning: 'learning', unrestricted: 'neutral', metre: 'metre'};
export const SAMPLE_PROMPT = '帮我把登录页的按钮改成蓝色，顺便跑一下测试，看看有没有别的地方也要改';

function sourceOf(stack) {
  for (const line of String(stack).split('\n').slice(2)) {
    const m = /(services[\\/][^:)]+\.mjs):(\d+)/.exec(line.replace(/file:\/\/\/?/, ''));
    if (m) return `${m[1].replace(/\\/g, '/')}:${m[2]}`;
  }
  return '?';
}

let loaded;
async function loadPlugins() {
  if (loaded) return loaded;
  const hooks = [];
  const tools = [];
  const api = {
    on: (name, fn, opts = {}) => hooks.push({name, fn, priority: Number(opts?.priority) || 0, source: sourceOf(new Error().stack)}),
    registerGatewayMethod: () => {},
    registerTool: (factory, opts) => tools.push({factory, name: opts?.name}),
    registerHttpRoute: () => ({}),
    registerService: () => {},
    registerCommand: () => {},
    logger: {info() {}, warn() {}, error() {}, debug() {}},
    runtime: {state: {resolveStateDir: () => process.env.PINKIE_STATE_ROOT}, config: {current: () => ({})}},
    session: {workflow: {enqueueNextTurnInjection: async () => {}, unscheduleSessionTurnsByTag: async () => ({removed: 0})}},
  };
  for (const dir of ['mode-architecture', 'project-scope']) {
    const entry = path.join(REPO, 'services', dir, 'index.mjs');
    if (!fs.existsSync(entry)) continue;
    const mod = await import(pathToFileURL(entry).href);
    const plugin = mod.default;
    try { (plugin.register || plugin.activate || plugin)?.call?.(plugin, api); } catch (error) { console.error(`[inventory] ${dir} register failed:`, error?.message); }
  }
  loaded = {hooks, tools};
  return loaded;
}

export async function pluginHooks() {
  if (!process.env.PINKIE_STATE_ROOT) process.env.PINKIE_STATE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'metre-inv-state-'));
  return loadPlugins();
}

function makeWorkspace(agentId) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `metre-inv-${agentId}-`));
  const src = path.join(REPO, 'personas', PERSONA_DIR[agentId] || agentId);
  if (fs.existsSync(src)) fs.cpSync(src, root, {recursive: true});
  return fs.realpathSync(root);
}

export function workspaceFileChars(agentId) {
  // OpenClaw 自己注入的工作区文件（bootstrap）：AGENTS / SOUL / IDENTITY / USER / TOOLS / HEARTBEAT / MEMORY。
  const src = path.join(REPO, 'personas', PERSONA_DIR[agentId] || agentId);
  const out = {};
  for (const name of ['AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'USER.md', 'TOOLS.md', 'HEARTBEAT.md', 'MEMORY.md']) {
    const file = path.join(src, name);
    if (fs.existsSync(file)) out[name] = fs.readFileSync(file, 'utf8').length;
  }
  return out;
}

export async function collect(agentId, {prompt = SAMPLE_PROMPT, sessionSuffix = 'inventory'} = {}) {
  if (!process.env.PINKIE_STATE_ROOT) process.env.PINKIE_STATE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'metre-inv-state-'));
  const {hooks, tools} = await loadPlugins();
  const workspaceDir = makeWorkspace(agentId);
  const sessionKey = `agent:${agentId}:${sessionSuffix}-${Date.now().toString(36)}`;
  const ctx = {agentId, sessionKey, sessionId: sessionKey, workspaceDir, runId: `run-${Date.now()}`, trigger: 'user'};
  const event = {prompt, messages: [], runId: ctx.runId};
  const rows = [];
  for (const hook of hooks.filter(h => h.name === 'before_agent_run' || h.name === 'message_received')) {
    try { await hook.fn(event, ctx); } catch {}
  }
  const ordered = hooks.filter(h => h.name === 'before_prompt_build').sort((a, b) => b.priority - a.priority);
  for (const hook of ordered) {
    let out;
    try { out = await hook.fn(event, ctx); } catch (error) { out = {error: String(error?.message || error)}; }
    const text = [out?.prependSystemContext, out?.appendSystemContext, out?.prependContext, out?.appendContext, out?.systemPrompt].filter(Boolean).join('\n');
    rows.push({source: hook.source, priority: hook.priority, chars: text.length, text, error: out?.error});
  }
  const toolNames = tools.map(t => {
    try { const made = t.factory({agentId, sessionKey, workspaceDir}); return made ? (Array.isArray(made) ? made.map(m => m.name) : made.name || t.name) : null; } catch { return null; }
  }).flat().filter(Boolean);
  fs.rmSync(workspaceDir, {recursive: true, force: true});
  const workspace = workspaceFileChars(agentId);
  const pluginChars = rows.reduce((n, r) => n + r.chars, 0);
  const workspaceChars = Object.values(workspace).reduce((n, v) => n + v, 0);
  return {agentId, rows, toolNames, workspace, pluginChars, workspaceChars, total: pluginChars + workspaceChars,
    text: rows.map(r => r.text).filter(Boolean).join('\n')};
}

// 每段注入的「块」：按【标题】或 ## 标题切开，方便逐项标留 / 去。
export function blocksOf(text) {
  return String(text).split(/\n(?=【[^】\n]{1,40}】|#{1,3} )/).map(s => s.trim()).filter(Boolean)
    .map(s => ({head: s.split('\n')[0].slice(0, 60), chars: s.length}));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const agents = args.filter(a => !a.startsWith('--'));
  const out = [];
  for (const agent of agents.length ? agents : ['project', 'metre']) out.push(await collect(agent));
  if (json) {
    console.log(JSON.stringify(out.map(o => ({...o, text: undefined, rows: o.rows.map(r => ({...r, text: undefined, blocks: blocksOf(r.text)}))})), null, 1));
  } else {
    for (const o of out) {
      console.log(`\n== ${o.agentId}：工作区文件 ${o.workspaceChars} 字 + 插件注入 ${o.pluginChars} 字 = ${o.total} 字；工具 ${o.toolNames.length} 个`);
      console.log('   工作区：', JSON.stringify(o.workspace));
      for (const r of o.rows) {
        if (!r.chars && !r.error) continue;
        console.log(`   ${String(r.chars).padStart(6)}  p=${r.priority}  ${r.source}${r.error ? '  ERROR ' + r.error : ''}`);
        for (const b of blocksOf(r.text)) console.log(`            ${String(b.chars).padStart(6)}  ${b.head}`);
      }
    }
  }
  process.exit(0);
}
