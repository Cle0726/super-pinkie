#!/usr/bin/env node
// 批 0 清点：把三个插件注册到一个假的 api 上，逐个调用 before_prompt_build 钩子，
// 记下每个钩子的来源文件、优先级、产出字数。不连网关、不调模型，状态目录和工作区都在临时目录里。
//
//   node tools/metre/inject-inventory.mjs [agentId ...]        # 默认 project metre
//   node tools/metre/inject-inventory.mjs --json project metre  # 机器可读
//
// 测试（tests/metre-inject.test.mjs）也用这里导出的 collect()。
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {openclawStateDir} from '../../services/mode-architecture/openclaw-paths.mjs';

// CI replays the same instrument against a detached, pinned main checkout.
// Only this tool honors the override; the product does not.
const REPO = process.env.PINKIE_INVENTORY_SOURCE_ROOT
  ? fs.realpathSync(path.resolve(process.env.PINKIE_INVENTORY_SOURCE_ROOT))
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PERSONA_DIR = {main: 'chat', project: 'project', thinking: 'thinking', learning: 'learning', unrestricted: 'neutral', metre: 'metre'};
export const SAMPLE_PROMPT = '帮我把登录页的按钮改成蓝色，顺便跑一下测试，看看有没有别的地方也要改';
export const LEGACY_MODES = Object.freeze(['main', 'project', 'thinking', 'learning', 'unrestricted']);
export const BASELINE_PROMPTS = Object.freeze([
  '帮我把登录页的按钮改成蓝色，顺便跑一下测试，看看有没有别的地方也要改',
  '帮我写一份市场调研报告，再做一个展示页面',
  '给这个新产品起几个名字，顺便想想海报怎么设计',
]);
const sha256 = text => crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');

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

function makeWorkspace(agentId, fixedName = '') {
  const root = fixedName
    ? (fs.rmSync(path.join(os.tmpdir(), fixedName), {recursive: true, force: true}),
      fs.mkdirSync(path.join(os.tmpdir(), fixedName), {recursive: true}),
      path.join(os.tmpdir(), fixedName))
    : fs.mkdtempSync(path.join(os.tmpdir(), `metre-inv-${agentId}-`));
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

export async function collect(agentId, {prompt = SAMPLE_PROMPT, sessionSuffix = 'inventory', fixedWorkspace = '', sessionKey: fixedKey = '', runId: fixedRunId = ''} = {}) {
  if (!process.env.PINKIE_STATE_ROOT) process.env.PINKIE_STATE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'metre-inv-state-'));
  const {hooks, tools} = await loadPlugins();
  const workspaceDir = makeWorkspace(agentId, fixedWorkspace);
  const sessionKey = fixedKey || `agent:${agentId}:${sessionSuffix}-${Date.now().toString(36)}`;
  const ctx = {agentId, sessionKey, sessionId: sessionKey, workspaceDir, runId: fixedRunId || `run-${Date.now()}`, trigger: 'user'};
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
  const madeTools = tools.map(t => {
    try { const made = t.factory({agentId, sessionKey, workspaceDir}); return made ? (Array.isArray(made) ? made : [made]) : []; } catch { return []; }
  }).flat().filter(Boolean);
  const toolNames = madeTools.map(m => m.name).filter(Boolean);
  const toolDefs = Object.fromEntries(madeTools.filter(m => m?.name).map(m => [m.name, {
    name: m.name,
    label: m.label || m.name,
    description: m.description || '',
    parameters: m.parameters || null,
  }]));
  fs.rmSync(workspaceDir, {recursive: true, force: true});
  const workspace = workspaceFileChars(agentId);
  const pluginChars = rows.reduce((n, r) => n + r.chars, 0);
  const workspaceChars = Object.values(workspace).reduce((n, v) => n + v, 0);
  return {agentId, workspaceDir, rows, toolNames, toolDefs, workspace, pluginChars, workspaceChars, total: pluginChars + workspaceChars,
    text: rows.map(r => r.text).filter(Boolean).join('\n')};
}

function normalizeBaselineText(text, workspaceDir, stateRoot) {
  let out = String(text || '');
  for (const [needle, repl] of [
    [workspaceDir, '<WORKSPACE>'],
    [workspaceDir.replace(/\\/g, '/'), '<WORKSPACE>'],
    [stateRoot, '<STATE_ROOT>'],
    [stateRoot.replace(/\\/g, '/'), '<STATE_ROOT>'],
  ]) {
    if (needle) out = out.replaceAll(needle, repl);
  }
  // 学习约定包含实时日期（Asia/Shanghai），跨天校验时归一化，不影响内容逐字比对。
  out = out.replace(/今天是 \d{4}-\d{2}-\d{2}（Asia\/Shanghai）/g, '今天是 <DATE>（Asia/Shanghai）');
  return out;
}

export async function collectBaseline({modes = LEGACY_MODES, prompts = BASELINE_PROMPTS} = {}) {
  const fixedState = fs.realpathSync((() => {
    const dir = path.join(os.tmpdir(), 'metre-inv-baseline-state');
    fs.rmSync(dir, {recursive: true, force: true});
    fs.mkdirSync(dir, {recursive: true});
    return dir;
  })());
  process.env.PINKIE_STATE_ROOT = fixedState;
  loaded = null;
  const origRandom = Math.random;
  let seed = 42;
  Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  try {
    const ddPath = path.join(REPO, 'services/mode-architecture/design-directions.mjs');
    if (fs.existsSync(ddPath)) {
      const dd = await import(pathToFileURL(ddPath).href);
      dd.forgetDirections?.();
    }
  } catch {}
  try {
    const modeEntries = {};
    for (const agentId of modes) {
      const samples = [];
      let toolSnapshots = {};
      let workspace = {};
      for (let i = 0; i < prompts.length; i++) {
        const prompt = prompts[i];
        const res = await collect(agentId, {
          prompt,
          fixedWorkspace: `metre-inv-baseline-${agentId}`,
          sessionKey: `agent:${agentId}:baseline-${i + 1}`,
          runId: `run-baseline-${agentId}-${i + 1}`,
        });
        if (i === 0) {
          workspace = res.workspace;
          toolSnapshots = {
            pinkie_session_start: res.toolDefs.pinkie_session_start || null,
            pinkie_mode_ask: res.toolDefs.pinkie_mode_ask || null,
          };
        }
        const normalizedText = normalizeBaselineText(res.text, res.workspaceDir, fixedState);
        samples.push({
          index: i + 1,
          prompt,
          workspaceChars: res.workspaceChars,
          pluginChars: res.pluginChars,
          total: res.total,
          sha256: sha256(normalizedText),
          text: normalizedText,
        });
      }
      const toolsJson = JSON.stringify(toolSnapshots);
      modeEntries[agentId] = {
        workspace,
        workspaceSha256: sha256(JSON.stringify(workspace)),
        toolSnapshots,
        toolSnapshotsSha256: sha256(toolsJson),
        samples,
      };
    }
    const metreRes = await collect('metre', {
      prompt: prompts[0],
      fixedWorkspace: 'metre-inv-baseline-metre',
      sessionKey: 'agent:metre:baseline-1',
      runId: 'run-baseline-metre-1',
    });
    const metreToolsBefore = {
      pinkie_session_start: metreRes.toolDefs.pinkie_session_start || null,
      pinkie_mode_ask: metreRes.toolDefs.pinkie_mode_ask || null,
    };
    const overallSha256 = sha256(JSON.stringify(modeEntries));
    return {
      overallSha256,
      prompts,
      modes: modeEntries,
      metreToolsBefore,
      metreToolsBeforeSha256: sha256(JSON.stringify(metreToolsBefore)),
    };
  } finally {
    Math.random = origRandom;
  }
}

// Only the two workspace-path fields can refer to the machine's default
// profile in the original Windows baseline. Compare the workspace name and
// every other character; do not hide custom project paths or other changes.
function profileNeutralSample(text, mode, stateDir) {
  if (typeof text !== 'string') return text;
  const workspace = mode === 'main' ? 'workspace' : 'workspace-' + mode;
  const target = stateDir && path.join(stateDir, workspace).replaceAll('\\', '/');
  return text.split('\n').map(line => {
    const m = /^(当前项目\/默认工作目录|当前模式自己的工作区)：(".*")$/.exec(line);
    if (!m) return line;
    let value;
    try { value = JSON.parse(m[2]).replaceAll('\\', '/'); } catch { return line; }
    const isDefault = target ? value === target :
      path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
    if (!isDefault || (!target && !value.endsWith('/.openclaw/' + workspace))) return line;
    return m[1] + '："<OPENCLAW_PROFILE>/' + workspace + '"';
  }).join('\n');
}

// Only compare filesystem suffixes attached to the inventory's own fixture
// markers across OSs. Backslashes elsewhere (commands, regexes, user prose)
// and changed relative filenames are still part of the snapshot.
export function portableBaselineSample(text, mode, stateDir) {
  const profileNeutral = profileNeutralSample(text, mode, stateDir);
  return typeof profileNeutral === 'string'
    ? profileNeutral.replace(/<(?:WORKSPACE|STATE_ROOT)>[\\/][\p{L}\p{N}_.\\/-]*/gu, value => value.replaceAll('\\', '/'))
    : profileNeutral;
}

export async function verifyBaseline(baselinePath) {
  const expected = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const stateDir = openclawStateDir();
  const actual = await collectBaseline({modes: Object.keys(expected.modes), prompts: expected.prompts});
  const diffs = [];
  let profileReplacements = 0;
  let portableMatches = 0;
  if (sha256(JSON.stringify(expected.modes)) !== expected.overallSha256) {
    diffs.push('archived baseline hash does not match its contents');
  }
  for (const [mode, expMode] of Object.entries(expected.modes)) {
    const actMode = actual.modes[mode];
    if (!actMode) { diffs.push(`${mode}: missing mode`); continue; }
    if (expMode.workspaceSha256 !== actMode.workspaceSha256) {
      diffs.push(`${mode}: workspace changed (${expMode.workspaceSha256} != ${actMode.workspaceSha256})`);
    }
    if (expMode.toolSnapshotsSha256 !== actMode.toolSnapshotsSha256) {
      diffs.push(`${mode}: pinkie_session_start / pinkie_mode_ask changed (${expMode.toolSnapshotsSha256} != ${actMode.toolSnapshotsSha256})`);
    }
    for (let i = 0; i < expMode.samples.length; i++) {
      const expSample = expMode.samples[i];
      const actSample = actMode.samples[i];
      if (expSample.sha256 !== actSample?.sha256) {
        if (actSample && profileNeutralSample(expSample.text, mode) === profileNeutralSample(actSample.text, mode, stateDir)) {
          profileReplacements++;
          continue;
        }
        if (actSample && portableBaselineSample(expSample.text, mode) === portableBaselineSample(actSample.text, mode, stateDir)) {
          portableMatches++;
          continue;
        }
        diffs.push(`${mode} sample #${i + 1}: sha256 mismatch (${expSample.sha256} != ${actSample?.sha256})`);
      }
    }
  }
  return {ok: diffs.length === 0 && (expected.overallSha256 === actual.overallSha256 || profileReplacements + portableMatches > 0),
    expectedOverall: expected.overallSha256, actualOverall: actual.overallSha256, profileReplacements, portableMatches, diffs, actual};
}

// 每段注入的「块」：按【标题】或 ## 标题切开，方便逐项标留 / 去。
export function blocksOf(text) {
  return String(text).split(/\n(?=【[^】\n]{1,40}】|#{1,3} )/).map(s => s.trim()).filter(Boolean)
    .map(s => ({head: s.split('\n')[0].slice(0, 60), chars: s.length}));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const saveIdx = args.indexOf('--save-baseline');
  if (saveIdx >= 0) {
    const target = path.resolve(args[saveIdx + 1] || 'briefs/metre-roles-1118/legacy-inject-baseline.json');
    const data = await collectBaseline();
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify({saved: target, overallSha256: data.overallSha256, metreToolsBeforeSha256: data.metreToolsBeforeSha256}, null, 2));
    process.exit(0);
  }
  const verifyIdx = args.indexOf('--verify-baseline');
  if (verifyIdx >= 0) {
    const target = path.resolve(args[verifyIdx + 1] || 'briefs/metre-roles-1118/legacy-inject-baseline.json');
    const res = await verifyBaseline(target);
    console.log(JSON.stringify({ok: res.ok, expectedOverall: res.expectedOverall, actualOverall: res.actualOverall,
      profileReplacements: res.profileReplacements, portableMatches: res.portableMatches, diffs: res.diffs}, null, 2));
    process.exit(res.ok ? 0 : 1);
  }
  const json = args.includes('--json');
  const agents = args.filter(a => !a.startsWith('--'));
  const out = [];
  for (const agent of agents.length ? agents : ['project', 'metre']) out.push(await collect(agent));
  if (json) {
    console.log(JSON.stringify(out.map(o => ({...o, text: undefined, toolDefs: undefined, rows: o.rows.map(r => ({...r, text: undefined, blocks: blocksOf(r.text)}))})), null, 1));
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
