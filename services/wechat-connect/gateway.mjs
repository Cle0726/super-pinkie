import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomUUID, createHash} from 'node:crypto';
import {loginConfig} from './legacy-cli-isolation.mjs';

export const CHANNEL = 'openclaw-weixin';
export const AGENT = 'unrestricted';
const ACTIVE = new Set(['starting', 'waiting', 'confirming', 'verify', 'finishing']);
const ACCOUNT_ID = /^[a-z0-9][a-z0-9_-]{0,119}$/;

export function isWechatQrUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      && ['weixin.qq.com', 'wechat.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch { return false; }
}

// Only recognize the official CLI's public prompts. Raw CLI output is never
// returned over RPC or stored; it can contain credentials and unrelated logs.
export class LoginOutputParser {
  constructor(onEvent) { this.onEvent = onEvent; this.buffer = ''; this.offset = 0; this.promptEnd = 0; this.qrUrl = ''; }
  feed(chunk) {
    this.buffer += String(chunk).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    if (this.buffer.length > 32768) {
      const drop = this.buffer.length - 32768;
      this.offset += drop; this.buffer = this.buffer.slice(drop);
    }
    const links = [...this.buffer.matchAll(/(?:二维码链接[:：]|以下链接以继续[:：])\s*(https?:\/\/[^\s\x1b]+)/g)];
    const last = links.at(-1)?.[1];
    if (last && last !== this.qrUrl && isWechatQrUrl(last)) {
      this.qrUrl = last; this.onEvent({type: 'qr', url: last});
    }
    const prompts = [...this.buffer.matchAll(/输入手机微信显示的数字，以继续连接：|你输入的数字不匹配，请重新输入：|正在验证|保存账号数据失败|已连接过此 OpenClaw，无需重复连接。/g)];
    const prompt = prompts.at(-1);
    if (prompt && this.offset + prompt.index + prompt[0].length > this.promptEnd) {
      this.promptEnd = this.offset + prompt.index + prompt[0].length;
      this.onEvent({type: prompt[0] === '正在验证' ? 'confirming' : prompt[0] === '保存账号数据失败' ? 'save-error'
        : prompt[0].startsWith('已连接过') ? 'already-connected' : 'verify', retry: prompt[0].includes('不匹配')});
    }
  }
}

export function readAccounts(stateDir) {
  const root = path.join(stateDir, CHANNEL);
  try {
    const index = JSON.parse(fs.readFileSync(path.join(root, 'accounts.json'), 'utf8'));
    if (!Array.isArray(index)) return [];
    return index.filter(id => typeof id === 'string' && ACCOUNT_ID.test(id)).flatMap(accountId => {
      try {
        const raw = fs.readFileSync(path.join(root, 'accounts', `${accountId}.json`), 'utf8');
        const saved = JSON.parse(raw);
        return typeof saved.token === 'string' && saved.token.trim() && typeof saved.userId === 'string' && saved.userId.trim()
          ? [{accountId, userId: saved.userId.trim(), revision: createHash('sha256').update(raw).digest('hex')}] : [];
      } catch { return []; }
    });
  } catch { return []; }
}

function bindingFor(config, accountId) {
  const matches = (config.bindings || []).filter(binding => binding.match?.channel === CHANNEL
    && [accountId, '*'].includes(binding.match?.accountId)
    && (!binding.match?.peer || (binding.match.peer.kind === 'direct' && binding.match.peer.id === '*')));
  return matches.find(binding => binding.match.accountId === accountId) || matches[0];
}
export function routeReady(config, accountId = '*') {
  const binding = bindingFor(config, accountId);
  return binding?.agentId === AGENT && binding.session?.dmScope === 'per-account-channel-peer'
    && config.agents?.list?.some(agent => agent.id === AGENT);
}

export function bindWechatAccount(draft, accountId) {
  if (!ACCOUNT_ID.test(accountId)) throw new Error('微信账户信息不完整，请重新扫码。');
  if (!routeReady(draft, accountId)) throw new Error('微信还没有接到挥洒模式，请先完成连接设置。');
  const exact = (draft.bindings || []).find(binding => binding.match?.channel === CHANNEL && binding.match?.accountId === accountId
    && binding.match?.peer?.kind === 'direct' && binding.match.peer.id === '*');
  if (!exact) draft.bindings.unshift({agentId: AGENT, match: {channel: CHANNEL, accountId, peer: {kind: 'direct', id: '*'}}, session: {dmScope: 'per-account-channel-peer'}});
  const section = (draft.channels ||= {})[CHANNEL] ||= {};
  section.accounts ||= {};
  section.accounts[accountId] = {...section.accounts[accountId], enabled: true};
  section.channelConfigUpdatedAt = new Date().toISOString();
}

export function resolveCliEntry(env = process.env, argv = process.argv) {
  const candidates = [env.PINKIE_OPENCLAW_ENTRY, env.OPENCLAW_ROOT && path.join(env.OPENCLAW_ROOT, 'openclaw.mjs'),
    '/Applications/超級碧琪.app/Contents/Resources/SuperPinkie/runtime/openclaw/openclaw.mjs', argv[1]];
  return candidates.find(entry => typeof entry === 'string' && /(?:[/\\]openclaw\.mjs|[/\\]openclaw[/\\]dist[/\\]index\.js)$/.test(entry) && fs.existsSync(entry)) || '';
}

export class WechatLoginManager {
  constructor({stateDir, config, mutate, cliEntry, makeQr, resolveRoute, spawnChild = spawn, now = Date.now, timeoutMs = 510000}) {
    Object.assign(this, {stateDir, config, mutate, cliEntry, makeQr, resolveRoute, spawnChild, now, timeoutMs});
    this.job = null; this.stopped = false;
  }
  accounts() {
    const config = this.config();
    return readAccounts(this.stateDir).map(account => ({accountId: account.accountId, enabled: config.channels?.[CHANNEL]?.accounts?.[account.accountId]?.enabled !== false
      && config.channels?.[CHANNEL]?.enabled !== false, routeReady: this.accountRouteReady(config, account)}));
  }
  accountRouteReady(config, account) {
    if (!routeReady(config, account.accountId) || typeof this.resolveRoute !== 'function') return false;
    try {
      const route = this.resolveRoute({cfg: config, channel: CHANNEL, accountId: account.accountId, peer: {kind: 'direct', id: account.userId}});
      return route.agentId === AGENT && route.lastRoutePolicy === 'session'
        && route.sessionKey.startsWith(`agent:${AGENT}:${CHANNEL}:${account.accountId}:direct:`);
    } catch { return false; }
  }
  status() {
    const job = this.job;
    return {available: true, agentId: AGENT, accounts: this.accounts(), job: job ? {
      id: job.id, state: job.state, message: job.message, startedAt: job.startedAt, expiresAt: job.expiresAt,
      qrUrl: job.qrUrl, qrDataUrl: job.qrDataUrl, qrGeneration: job.qrGeneration,
    } : null};
  }
  async start() {
    if (this.stopped) throw new Error('连接服务正在更新，请稍后重试。');
    if (this.job && ACTIVE.has(this.job.state)) return this.status();
    if (!routeReady(this.config())) throw new Error('微信还没有接到挥洒模式，请先完成连接设置。');
    if (!this.cliEntry) throw new Error('微信连接服务暂时不可用。');
    const job = {id: randomUUID(), state: 'starting', message: '正在生成微信二维码…', startedAt: this.now(),
      expiresAt: this.now() + this.timeoutMs, qrUrl: '', qrDataUrl: '', qrGeneration: 0, child: null, timer: null};
    this.job = job;
    const initialAccounts = readAccounts(this.stateDir);
    const initialRevisions = new Map(initialAccounts.map(account => [account.accountId, account.revision]));
    const parser = new LoginOutputParser(event => {
      if (this.job !== job || !ACTIVE.has(job.state)) return;
      if (event.type === 'qr') {
        const generation = ++job.qrGeneration;
        job.qrUrl = event.url; job.qrDataUrl = ''; job.state = 'waiting';
        job.message = generation === 1 ? '用手机微信扫一扫，再确认连接。' : '二维码已更新，请扫描新二维码。';
        Promise.resolve().then(() => this.makeQr(event.url)).then(data => {
          if (this.job === job && ACTIVE.has(job.state) && job.qrGeneration === generation) job.qrDataUrl = data;
        }).catch(() => { if (this.job === job) job.message = '二维码图片暂时没生成，请使用连接链接。'; });
      } else if (event.type === 'save-error') {
        this.fail(job, '微信账户没有保存成功，请重新扫码。');
      } else if (event.type === 'already-connected') {
        job.alreadyConnected = true;
      } else {
        job.state = event.type;
        job.message = event.type === 'verify' ? (event.retry ? '数字不匹配，请重新输入手机微信显示的数字。' : '请输入手机微信显示的数字。') : '已扫描，正在确认连接…';
      }
    });
    try {
      job.loginConfigDir = fs.mkdtempSync(path.join(this.stateDir, '.pinkie-wechat-login-'));
      fs.chmodSync(job.loginConfigDir, 0o700);
      const configPath = path.join(job.loginConfigDir, 'openclaw.json');
      fs.writeFileSync(configPath, JSON.stringify(loginConfig(this.config())), {mode: 0o600, flag: 'wx'});
      job.child = this.spawnChild(process.execPath, [this.cliEntry, 'channels', 'login', '--channel', CHANNEL],
        {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: {...process.env,
          OPENCLAW_STATE_DIR: this.stateDir, OPENCLAW_CONFIG_PATH: configPath,
          PINKIE_WECHAT_LOGIN_ISOLATED: '1', NO_COLOR: '1'}});
      job.child.stdout?.setEncoding?.('utf8'); job.child.stdout?.on('data', chunk => parser.feed(chunk));
      job.child.stderr?.resume?.();
      job.child.stdin?.on('error', () => { this.fail(job, '数字提交未完成，请重新扫码。'); this.kill(job); });
      job.child.once('error', () => { this.cleanupLoginConfig(job); this.fail(job, '微信扫码启动失败，请重试。'); });
      job.child.once('close', code => { this.cleanupLoginConfig(job); void this.finish(job, code, initialAccounts, initialRevisions); });
      job.timer = setTimeout(() => { this.fail(job, '二维码已过期，请重新生成。', 'expired'); this.kill(job); }, this.timeoutMs);
      job.timer.unref?.();
    } catch { this.cleanupLoginConfig(job); this.fail(job, '微信扫码启动失败，请重试。'); }
    return this.status();
  }
  cleanupLoginConfig(job) {
    if (!job.loginConfigDir) return;
    try { fs.rmSync(job.loginConfigDir, {recursive: true, force: true}); } catch { /* Private temporary files can be removed later. */ }
    job.loginConfigDir = null;
  }
  fail(job, message, state = 'error') {
    if (this.job !== job || !ACTIVE.has(job.state)) return;
    clearTimeout(job.timer); job.state = state; job.message = message; job.qrUrl = ''; job.qrDataUrl = '';
  }
  async finish(job, code, initialAccounts, initialRevisions) {
    clearTimeout(job.timer);
    if (this.job !== job || !ACTIVE.has(job.state)) return;
    const accounts = readAccounts(this.stateDir);
    const changed = accounts.filter(account => initialRevisions.get(account.accountId) !== account.revision);
    const account = changed.length === 1 ? changed[0] : job.alreadyConnected && initialAccounts.length === 1
      ? accounts.find(item => item.accountId === initialAccounts[0].accountId) : null;
    if (code !== 0 || !account) { this.fail(job, '微信连接未完成，请重新扫码。'); return; }
    job.state = 'finishing'; job.message = '扫码已确认，正在接入挥洒模式…';
    try {
      await this.mutate(draft => {
        if (this.stopped || this.job !== job || job.state !== 'finishing') throw new Error('连接已停止。');
        bindWechatAccount(draft, account.accountId);
        if (!this.accountRouteReady(draft, account)) throw new Error('微信路由与现有设置冲突。');
      });
      if (this.job !== job || !ACTIVE.has(job.state)) return;
      job.state = 'connected'; job.message = '微信已连接到挥洒模式。'; job.qrUrl = ''; job.qrDataUrl = '';
    } catch { this.fail(job, '微信已扫码，但挥洒模式连接还没完成，请重试。'); }
  }
  verify({id, code}) {
    const job = this.job;
    if (!job || job.id !== id || job.state !== 'verify' || !job.child?.stdin?.writable) throw new Error('当前没有等待验证的微信连接。');
    if (!/^\d{1,12}$/.test(String(code || ''))) throw new Error('请输入手机微信显示的数字。');
    job.child.stdin.write(`${code}\n`, error => { if (error) { this.fail(job, '数字提交未完成，请重新扫码。'); this.kill(job); } });
    job.state = 'confirming'; job.message = '已提交数字，正在确认连接…';
    return this.status();
  }
  kill(job) {
    const child = job.child;
    if (!child || child.exitCode !== null && child.exitCode !== undefined) return;
    child.kill('SIGTERM');
    const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 3000);
    timer.unref?.();
  }
  cancel({id}) {
    const job = this.job;
    if (!job || id !== job.id) throw new Error('这次连接已经结束，请刷新状态。');
    if (job.state === 'finishing') throw new Error('扫码已确认，正在完成连接，请稍等。');
    this.fail(job, '已取消连接。', 'cancelled'); this.kill(job);
    return this.status();
  }
  async disconnect({accountId}) {
    if (!this.accounts().some(account => account.accountId === accountId && account.routeReady)) throw new Error('没有找到这次微信连接。');
    await this.mutate(draft => { const section = (draft.channels ||= {})[CHANNEL] ||= {}; section.accounts ||= {};
      section.accounts[accountId] = {...section.accounts[accountId], enabled: false}; });
    return this.status();
  }
  stop() { this.stopped = true; if (this.job && ACTIVE.has(this.job.state)) {
    this.fail(this.job, '连接服务已更新，请重新扫码。', 'cancelled'); this.kill(this.job);
  } }
}

export default {
  id: 'pinkie-wechat-connect', name: '碧琪微信连接',
  register(api) {
    // CLI metadata/registration must not start workers. Only the running
    // gateway owns this manager, and each login has its own isolated stdin.
    const cliEntry = resolveCliEntry();
    const manager = new WechatLoginManager({
      stateDir: api.runtime.state.resolveStateDir(), cliEntry,
      config: () => api.runtime.config.current(),
      resolveRoute: params => api.runtime.channel.routing.resolveAgentRoute(params),
      mutate: mutate => api.runtime.config.mutateConfigFile({base: 'source', afterWrite: {mode: 'auto'}, mutate}),
      makeQr: async url => {
        const require = createRequire(cliEntry || import.meta.url);
        return require('qrcode').toDataURL(url, {width: 320, margin: 4, errorCorrectionLevel: 'M'});
      },
    });
    const register = (name, scope, run) => api.registerGatewayMethod(name, async ({params, respond}) => {
      try { respond(true, await run(params || {})); }
      catch (error) { respond(false, undefined, {code: 'INVALID_REQUEST', message: error.message}); }
    }, {scope});
    register('pinkie.wechat.status', 'operator.read', () => manager.status());
    register('pinkie.wechat.login.start', 'operator.admin', () => manager.start());
    register('pinkie.wechat.login.verify', 'operator.admin', params => manager.verify(params));
    register('pinkie.wechat.login.cancel', 'operator.admin', params => manager.cancel(params));
    register('pinkie.wechat.disconnect', 'operator.admin', params => manager.disconnect(params));
    api.registerService({id: 'pinkie-wechat-connect', start() { manager.stopped = false; }, stop() { manager.stop(); }});
  },
};
