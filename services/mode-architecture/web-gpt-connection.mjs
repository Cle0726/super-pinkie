import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const VALID_SESSION = /^agent:(main|project|thinking|learning|unrestricted):/;
const MAX_OUTPUT = 64 * 1024;
const TRANSIENT_TUNNEL_ERROR = /Tunnel start timed out|fetch failed|public health endpoint|cloudflared exited before|安全隧道暂时没有连通/i;
const FATAL_TUNNEL_STATUS = /Unauthorized|Tunnel not found|no recent network activity|operation was aborted due to timeout/i;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function bridgePublicReady(bridge) {
  const detail = [bridge?.error, bridge?.tunnel?.detail].filter(Boolean).join('\n');
  return bridge?.running === true
    && !FATAL_TUNNEL_STATUS.test(detail)
    && Boolean(bridge?.publicUrl || bridge?.tunnel?.running);
}

function stateRoot() {
  if (process.env.PINKIE_STATE_ROOT) return path.resolve(process.env.PINKIE_STATE_ROOT);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'SuperPinkie');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || os.homedir(), 'SuperPinkie');
  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'super-pinkie');
}

function assertSession(sessionKey) {
  const key = String(sessionKey || '');
  if (!VALID_SESSION.test(key)) throw new Error('缺少有效的碧琪会话标识');
  return key;
}

function validateWorkspace(candidate) {
  if (!path.isAbsolute(candidate) || candidate.includes('\0')) throw new Error('网页 GPT 工作区路径无效');
  let resolved;
  try { resolved = fs.realpathSync(candidate); } catch { throw new Error('网页 GPT 工作区不存在'); }
  if (!fs.statSync(resolved).isDirectory()) throw new Error('网页 GPT 工作区不是文件夹');
  const broadRoots = [
    path.parse(resolved).root,
    os.homedir(),
    path.dirname(os.homedir()),
    path.join(os.homedir(), 'Desktop'),
    path.join(os.homedir(), 'Documents'),
    path.join(os.homedir(), '.openclaw'),
    path.join(os.homedir(), '.codex'),
  ].filter(item => fs.existsSync(item)).map(item => fs.realpathSync(item));
  if (broadRoots.includes(resolved)) throw new Error('请选择具体项目，不能把整台电脑或整个用户目录连接给网页 GPT');
  return resolved;
}

function boundWorkspaceFor(sessionKey, requested = '', bindingFile = path.join(stateRoot(), 'project-scope', 'bindings.json')) {
  const key = assertSession(sessionKey);
  let bindings = {};
  if (fs.existsSync(bindingFile)) {
    try { bindings = JSON.parse(fs.readFileSync(bindingFile, 'utf8')); }
    catch { throw new Error('项目绑定记录不可读，已停止网页文件连接'); }
  }
  const stored = typeof bindings?.[key]?.root === 'string' ? bindings[key].root : '';
  if (!stored) return '';
  const bound = validateWorkspace(stored);
  if (requested) {
    const proposed = validateWorkspace(requested);
    if (proposed !== bound) throw new Error('网页 GPT 只能读取当前会话明确绑定的用户项目');
  }
  return bound;
}

function chatGptConversationUrl(value) {
  const raw = String(value || '').trim();
  let url;
  try { url = new URL(raw); } catch { throw new Error('网页 ChatGPT 对话地址无效'); }
  const host = url.hostname.toLowerCase();
  if (!(host === 'chatgpt.com' || host.endsWith('.chatgpt.com'))) throw new Error('只能绑定 chatgpt.com 对话');
  if (!/(?:^|\/)c\/[^/?#]+/.test(url.pathname)) throw new Error('请先在网页 ChatGPT 中发出一条消息，生成真实对话后再绑定');
  url.hash = '';
  return url.toString();
}

function parseJsonOutput(stdout = '') {
  const lines = String(stdout || '').trim().split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]); } catch {}
  }
  return null;
}

function friendlyError(error) {
  const raw = [error?.stdout, error?.stderr, error?.message].filter(Boolean).join('\n');
  const parsed = parseJsonOutput(raw);
  const text = String(parsed?.error || parsed?.message || raw || '网页 GPT 连接操作失败').trim();
  if (/NEED_CLOUDFLARED|cloudflared is not installed/i.test(text)) {
    return '缺少安全连接组件 cloudflared，暂时不能建立外部连接';
  }
  if (TRANSIENT_TUNNEL_ERROR.test(text)) {
    return '安全隧道暂时没有连通，请检查网络后重试';
  }
  return text.slice(0, 2_000);
}

export class WebGptConnectionManager {
  constructor({
    root = path.join(stateRoot(), 'web-gpt-collab'),
    bindingFile = path.join(stateRoot(), 'project-scope', 'bindings.json'),
  } = {}) {
    this.root = path.resolve(root);
    this.bindingFile = path.resolve(bindingFile);
    this.cli = path.join(this.root, process.platform === 'win32' ? 'pinkie-collab.cmd' : 'pinkie-collab');
  }

  workspace(sessionKey, requestedWorkspace = '', {allowUnbound = false} = {}) {
    const workspace = boundWorkspaceFor(sessionKey, requestedWorkspace, this.bindingFile);
    if (!workspace && !allowUnbound) {
      throw new Error('当前会话未绑定用户项目；网页 GPT 不会读取碧琪记忆或内部工作区');
    }
    return workspace;
  }

  async run(args, {timeout = 30_000, allowPlain = false} = {}) {
    if (!fs.existsSync(this.cli)) throw new Error('网页 GPT 本地桥接还没有安装');
    try {
      const {stdout = '', stderr = ''} = await execFileAsync(this.cli, args, {
        timeout,
        maxBuffer: MAX_OUTPUT,
        windowsHide: true,
        env: process.env,
      });
      const parsed = parseJsonOutput(stdout);
      if (parsed) return parsed;
      if (allowPlain) return {ok: true, message: String(stdout || stderr || '').trim().slice(0, 2_000)};
      throw new Error(String(stdout || stderr || '桥接没有返回状态').trim());
    } catch (error) {
      throw new Error(friendlyError(error));
    }
  }

  async status(sessionKey, requestedWorkspace = '') {
    const workspace = this.workspace(sessionKey, requestedWorkspace, {allowUnbound: true});
    if (!workspace) {
      return {
        ok: true,
        workspace: '',
        projectRequired: true,
        bridge: {ok: true, running: false, publicReady: false, state: 'unbound'},
        preferences: {},
        conversation: {},
        diagnostics: {project: {ok: false, detail: '当前会话未绑定用户项目'}},
        accountIdentity: '由内置 ChatGPT 页面显示',
      };
    }
    const safeRun = async args => {
      try { return await this.run(args); } catch (error) { return {ok: false, error: error.message}; }
    };
    const [bridge, preferences, conversation, diagnostics] = await Promise.all([
      safeRun(['status', '-w', workspace, '--json']),
      safeRun(['prefs', 'get', '--json']),
      safeRun(['session', 'get', '-w', workspace, '--json']),
      safeRun(['doctor', '-w', workspace, '--no-fix', '--json']),
    ]);
    const normalizedBridge = {...bridge, publicReady: bridgePublicReady(bridge)};
    return {
      ok: true,
      workspace,
      bridge: normalizedBridge,
      preferences,
      conversation: conversation?.conversation || conversation?.session || conversation,
      diagnostics,
      accountIdentity: '由内置 ChatGPT 页面显示',
    };
  }

  async start(sessionKey, requestedWorkspace = '') {
    const workspace = this.workspace(sessionKey, requestedWorkspace);
    let started;
    try {
      started = await this.run(['start', '-w', workspace, '--tunnel', '--json'], {timeout: 52_000});
    } catch (firstError) {
      const observed = await this.status(sessionKey, workspace);
      const becameReady = observed.bridge?.publicReady === true;
      if (becameReady) return {...observed, started: {ok: true, recovered: true}};
      if (!TRANSIENT_TUNNEL_ERROR.test(String(firstError?.message || ''))) throw firstError;
      // Quick tunnels can publish their URL before the public health endpoint
      // becomes reachable. One bounded retry fixes that race without spawning
      // extra bridges or looping forever.
      await wait(900);
      try {
        started = await this.run(['start', '-w', workspace, '--tunnel', '--json'], {timeout: 52_000});
      } catch (secondError) {
        throw new Error(`安全隧道两次启动都没有连通：${secondError.message}`);
      }
    }
    return {...await this.status(sessionKey, workspace), started};
  }

  async pair(sessionKey, requestedWorkspace = '') {
    const workspace = this.workspace(sessionKey, requestedWorkspace);
    const before = await this.status(sessionKey, workspace);
    const publiclyReachable = before.bridge?.publicReady === true;
    if (!publiclyReachable) throw new Error('请先建立安全连接，再生成配对码');
    const rawPairing = await this.run(['pair', '-w', workspace, '--json']);
    const pairing = {
      ...rawPairing,
      pairingExpiresAt: rawPairing.pairingExpiresAt || rawPairing.expiresAt || 0,
    };
    return {...await this.status(sessionKey, workspace), pairing};
  }

  async clearConversation(sessionKey, requestedWorkspace = '') {
    const workspace = this.workspace(sessionKey, requestedWorkspace);
    const cleared = await this.run(['session', 'clear', '-w', workspace], {allowPlain: true});
    return {...await this.status(sessionKey, workspace), cleared};
  }

  async bindConversation(sessionKey, requestedWorkspace = '', value = '') {
    const workspace = this.workspace(sessionKey, requestedWorkspace);
    const url = chatGptConversationUrl(value);
    const before = await this.status(sessionKey, workspace);
    const connectorName = String(
      before.conversation?.connectorName
      || before.diagnostics?.chatgptRepair?.connectorName
      || before.bridge?.connectorName
      || `Codex with ChatGPT · ${path.basename(workspace)}`,
    ).slice(0, 240);
    const saved = await this.run([
      'session', 'set', '-w', workspace,
      '--url', url,
      '--mode', 'long-chat',
      '--connector-name', connectorName,
    ], {allowPlain: true});
    return {...await this.status(sessionKey, workspace), saved};
  }

  async unpair(sessionKey, requestedWorkspace = '', confirmation = '') {
    if (confirmation !== 'UNPAIR_CURRENT_WEB_GPT') throw new Error('缺少断开当前网页 GPT 授权的确认');
    const workspace = this.workspace(sessionKey, requestedWorkspace);
    const revoked = await this.run(['unpair', '-w', workspace], {allowPlain: true});
    return {...await this.status(sessionKey, workspace), revoked};
  }
}

export function registerWebGptConnectionGateway(api, manager) {
  const handle = method => async ({params, respond}) => {
    try {
      const result = await manager[method](
        String(params?.sessionKey || ''),
        String(params?.workspace || ''),
        String(params?.confirm || ''),
      );
      respond(true, result);
    } catch (error) {
      respond(false, undefined, {code: 'INVALID_REQUEST', message: error instanceof Error ? error.message : String(error)});
    }
  };
  api.registerGatewayMethod('pinkie.webGpt.connection.get', handle('status'), {scope: 'operator.admin'});
  api.registerGatewayMethod('pinkie.webGpt.connection.start', handle('start'), {scope: 'operator.admin'});
  api.registerGatewayMethod('pinkie.webGpt.connection.pair', handle('pair'), {scope: 'operator.admin'});
  api.registerGatewayMethod('pinkie.webGpt.connection.clearConversation', handle('clearConversation'), {scope: 'operator.admin'});
  api.registerGatewayMethod('pinkie.webGpt.connection.bindConversation', async ({params, respond}) => {
    try {
      const result = await manager.bindConversation(
        String(params?.sessionKey || ''),
        String(params?.workspace || ''),
        String(params?.url || ''),
      );
      respond(true, result);
    } catch (error) {
      respond(false, undefined, {code: 'INVALID_REQUEST', message: error instanceof Error ? error.message : String(error)});
    }
  }, {scope: 'operator.admin'});
  api.registerGatewayMethod('pinkie.webGpt.connection.unpair', handle('unpair'), {scope: 'operator.admin'});
}
