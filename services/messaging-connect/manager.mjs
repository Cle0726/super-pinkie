import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { isOfficialQrUrl } from './official-providers.mjs';

const ACTIVE = new Set(['starting', 'waiting', 'confirming', 'finishing', 'pairing']);
const sha = value => createHash('sha256').update(value).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function credentialInput(channel, input) {
  const appId = typeof input?.appId === 'string' ? input.appId.trim() : '';
  const appSecret = typeof input?.appSecret === 'string' ? input.appSecret.trim() : '';
  const idPattern = channel === 'feishu' ? /^cli_[A-Za-z0-9_-]{4,100}$/ : /^[A-Za-z0-9_-]{4,100}$/;
  if (!idPattern.test(appId) || !appSecret || appSecret.length > 512 || /[\r\n\0]/.test(appSecret)) {
    throw new Error('请填写有效的 App ID 和 App Secret。');
  }
  return { appId, appSecret };
}

export function ownRoute(config, { channel, agentId, accountId }, resolveRoute, peerId = 'pinkie-route-check') {
  if (!config.agents?.list?.some(agent => agent.id === agentId)) return null;
  try {
    const route = resolveRoute({ cfg: config, channel, accountId, peer: { kind: 'direct', id: peerId } });
    return route?.agentId === agentId && route.lastRoutePolicy === 'session'
      && route.sessionKey?.startsWith(`agent:${agentId}:${channel}:${accountId}:direct:`) ? route : null;
  } catch { return null; }
}

export function saveAccount(draft, options, credentials, resolveRoute) {
  const { channel, accountId, label } = options;
  if (channel === 'feishu' && !/^ou_[A-Za-z0-9_-]+$/.test(credentials.openId || '')) throw new Error('没有确认飞书帐号身份，请重新扫码。');
  if (!ownRoute(draft, options, resolveRoute, credentials.openId)) throw new Error('当前连接路由与已有设置冲突，请先检查模式绑定。');
  const section = (draft.channels ||= {})[channel] ||= {};
  section.accounts ||= {};
  section.enabled = true;
  const existing = section.accounts[accountId] || {};
  const common = { ...existing, name: `碧琪 · ${label}`, enabled: true, appId: credentials.appId,
    connectionMode: 'websocket', groupPolicy: 'disabled', streaming: true };
  if (channel === 'feishu') {
    section.accounts[accountId] = { ...common, domain: credentials.domain === 'lark' ? 'lark' : 'feishu',
      appSecret: credentials.appSecret, dmPolicy: 'allowlist', allowFrom: [credentials.openId] };
  } else {
    delete common.connectionMode;
    delete common.streaming;
    const allowFrom = existing.appId === credentials.appId ? (existing.allowFrom || []).filter(id => typeof id === 'string' && id !== '*') : [];
    section.accounts[accountId] = { ...common, clientSecret: credentials.appSecret, dmPolicy: 'pairing', allowFrom };
  }
}

export class MessagingLoginManager {
  constructor(options) {
    Object.assign(this, options);
    this.job = null; this.stopped = false; this.provider = null; this.runtimeSnapshot = () => ({});
    this.projectFile = path.join(this.stateDir, 'pinkie-messaging-connect', 'qq-project.json');
  }
  route(config, peerId) { return ownRoute(config, this, this.resolveRoute, peerId); }
  account(config = this.config()) { return config.channels?.[this.channel]?.accounts?.[this.accountId]; }
  readProject(config = this.config()) {
    if (this.channel !== 'qqbot') return '';
    try {
      const saved = JSON.parse(fs.readFileSync(this.projectFile, 'utf8'));
      return saved.accountId === this.accountId && saved.appIdHash === sha(this.account(config)?.appId || '') && typeof saved.root === 'string' ? saved.root : '';
    } catch { return ''; }
  }
  saveProject(root, appId) {
    fs.mkdirSync(path.dirname(this.projectFile), { recursive: true, mode: 0o700 });
    const temp = `${this.projectFile}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ accountId: this.accountId, appIdHash: sha(appId), root }), { mode: 0o600 });
    fs.renameSync(temp, this.projectFile);
  }
  async status() {
    const cfg = this.config(), account = this.account(cfg);
    const configured = Boolean(account?.appId && (account.appSecret || account.clientSecret));
    const projectRoot = this.readProject(cfg);
    const allowed = this.channel === 'qqbot' && configured ? await this.readAllowed() : [];
    let paired = this.channel !== 'qqbot';
    if (this.channel === 'qqbot' && projectRoot && allowed.length) {
      try {
        paired = this.validateProject(projectRoot) === projectRoot && allowed.every(id => {
          const route = this.route(cfg, id);
          return route && this.projectBinding(route.sessionKey)?.root === projectRoot;
        });
      } catch { paired = false; }
    }
    const enabled = configured && account.enabled !== false && cfg.channels?.[this.channel]?.enabled !== false;
    const owner = this.channel === 'feishu' ? account?.allowFrom?.[0] : allowed[0];
    const routeReady = Boolean(this.route(cfg, owner));
    const runtime = this.runtimeSnapshot()?.channelAccounts?.[this.channel]?.[this.accountId] || {};
    const connected = enabled && runtime.connected === true;
    const ready = connected && routeReady && paired;
    if (ready && this.job?.waitingForConnection) {
      this.job.state = 'connected'; this.job.message = `${this.title}已连接到${this.label}。`;
      this.job.waitingForConnection = false;
    }
    const job = this.job;
    return { available: true, agentId: this.agentId, ...(this.channel === 'qqbot' ? { projectRoot } : {}),
      accounts: configured ? [{ accountId: this.accountId, enabled, configured, routeReady, running: runtime.running === true,
        connected, paired, needsPairing: this.channel === 'qqbot' && !paired }] : [],
      job: job ? { id: job.id, state: job.state, message: job.message, qrUrl: job.qrUrl, qrDataUrl: job.qrDataUrl,
        qrGeneration: job.qrGeneration, expiresAt: job.expiresAt } : null };
  }
  isCurrent(job) { return !this.stopped && this.job === job && ACTIVE.has(job.state) && !job.abort.signal.aborted; }
  clearQr(job) { job.qrUrl = ''; job.qrDataUrl = ''; job.qrGeneration += 1; }
  fail(job, message, state = 'error') {
    if (this.job !== job || !ACTIVE.has(job.state)) return;
    clearTimeout(job.timer); this.clearQr(job); job.state = state; job.message = message;
    job.abort.abort();
  }
  newJob(projectRoot) {
    const job = { id: randomUUID(), state: 'starting', message: `正在准备${this.title}连接…`, qrUrl: '', qrDataUrl: '',
      qrGeneration: 0, expiresAt: Date.now() + 600000, abort: new AbortController(), projectRoot };
    job.timer = setTimeout(() => this.fail(job, '二维码已过期，请重新扫码。', 'expired'), 600000);
    job.timer.unref?.(); this.job = job; return job;
  }
  requireProject(raw) {
    if (this.channel !== 'qqbot') return '';
    if (typeof raw !== 'string' || !raw.trim()) throw new Error('请先选择QQ要绑定的项目目录。');
    return this.validateProject(raw.trim());
  }
  async start(params = {}) {
    if (this.stopped) throw new Error('连接服务正在更新，请稍后再试。');
    if (this.verifying) throw new Error('正在确认QQ帐号，请稍等。');
    if (!this.route(this.config())) throw new Error('当前连接还没有绑定到指定模式。');
    const projectRoot = this.requireProject(params.projectRoot);
    if (this.job && ACTIVE.has(this.job.state)) {
      if (this.channel === 'qqbot' && projectRoot !== this.job.projectRoot) throw new Error('这次连接已选择了另一个项目，请先取消连接。');
      return this.status();
    }
    const current = await this.status();
    if (this.channel === 'qqbot' && current.accounts.length && !current.accounts[0].paired) {
      if (projectRoot !== this.readProject()) throw new Error('这个QQ连接已选择了另一个项目，请使用原项目目录。');
      const appId = this.account()?.appId;
      const job = this.newJob(projectRoot);
      job.state = 'finishing';
      try { await this.mutate(draft => {
        if (!this.isCurrent(job)) throw new Error('连接已经取消。');
        const section = draft.channels.qqbot, account = section.accounts[this.accountId];
        if (account.appId !== appId) throw new Error('QQ应用信息已更新，请刷新后重试。');
        section.enabled = true; account.enabled = true;
      }); } catch (error) { this.fail(job, '恢复连接未完成，请刷新后重试。'); throw error; }
      clearTimeout(job.timer); job.state = 'pairing'; job.waitingForConnection = true;
      job.message = '请在QQ发一句话，再填入收到的配对码，确认你的帐号。';
      return this.status();
    }
    if (this.channel === 'qqbot' && current.accounts[0]?.paired && projectRoot !== this.readProject()) throw new Error('这个QQ机器人已绑定项目，请使用原项目目录，或用另一个机器人连接新项目。');
    const job = this.newJob(projectRoot);
    void this.run(job).catch(() => this.fail(job, `${this.title}扫码未完成，请重试或手动填写应用信息。`));
    return this.status();
  }
  async getProvider() { return this.provider ||= await this.loadProvider(); }
  async setQr(job, url, expireIn) {
    if (!this.isCurrent(job)) return;
    if (!isOfficialQrUrl(this.channel, url)) throw new Error('没有收到有效的官方二维码。');
    const generation = ++job.qrGeneration;
    job.state = 'waiting'; job.qrUrl = url; job.qrDataUrl = ''; job.message = `用手机${this.title}扫一扫，按手机提示确认。`;
    if (Number.isFinite(expireIn) && expireIn > 0) job.expiresAt = Math.min(job.expiresAt, Date.now() + Math.min(expireIn, 600) * 1000);
    const image = await this.makeQr(url);
    if (this.isCurrent(job) && generation === job.qrGeneration) job.qrDataUrl = image;
  }
  async run(job) {
    const provider = await this.getProvider(); if (!this.isCurrent(job)) return;
    const outcome = await provider.login({ signal: job.abort.signal, onQr: (url, expiry) => this.setQr(job, url, expiry),
      onExpired: () => { if (this.isCurrent(job)) { this.clearQr(job); job.state = 'starting'; job.message = '二维码过期了，正在刷新…'; } } });
    if (!this.isCurrent(job)) return;
    if (outcome.status !== 'success') { this.fail(job, outcome.status === 'access_denied' ? '手机上取消了授权，请重新扫码。' : '二维码已过期或授权未完成，请重新扫码。', 'expired'); return; }
    await this.finish(job, outcome.credentials);
  }
  async manual(params) {
    const credentials = credentialInput(this.channel, params), projectRoot = this.requireProject(params?.projectRoot);
    if (this.stopped) throw new Error('连接服务正在更新，请稍后再试。');
    if (this.verifying) throw new Error('正在确认QQ帐号，请稍等。');
    if (this.job?.state === 'finishing') throw new Error('正在完成连接，请稍等。');
    if (this.job && ACTIVE.has(this.job.state)) this.fail(this.job, '已改用手动连接。', 'cancelled');
    if (!this.route(this.config())) throw new Error('当前连接还没有绑定到指定模式。');
    if (this.channel === 'qqbot' && credentials.appId === this.account()?.appId && this.readProject() !== projectRoot) throw new Error('这个QQ机器人已选择了另一个项目，请使用原项目目录。');
    const job = this.newJob(projectRoot); job.state = 'confirming'; job.message = '正在验证应用信息…';
    void this.finish(job, credentials).catch(() => this.fail(job, '应用信息没有通过验证，请检查 App ID 和 App Secret。'));
    return this.status();
  }
  async finish(job, rawCredentials) {
    const provider = await this.getProvider();
    const credentials = await provider.validate({ ...credentialInput(this.channel, rawCredentials), ...(this.channel === 'feishu'
      ? { domain: rawCredentials.domain, openId: rawCredentials.openId } : {}) }, job.abort.signal);
    if (!this.isCurrent(job)) return;
    job.state = 'finishing'; job.message = `扫码已确认，正在接入${this.label}…`; this.clearQr(job);
    if (this.channel === 'qqbot') this.validateProject(job.projectRoot);
    const previousAppId = this.account()?.appId;
    if (this.channel === 'qqbot' && previousAppId === credentials.appId && this.readProject() !== job.projectRoot) throw new Error('这个QQ机器人已选择了另一个项目，请使用原项目目录。');
    if (this.channel === 'qqbot' && previousAppId && previousAppId !== credentials.appId) await this.clearApproved();
    if (!this.isCurrent(job)) return;
    await this.mutate(draft => {
      if (!this.isCurrent(job)) throw new Error('连接已经取消。');
      if (draft.channels?.[this.channel]?.accounts?.[this.accountId]?.appId !== previousAppId) throw new Error('应用信息已更新，请刷新后重试。');
      saveAccount(draft, this, credentials, this.resolveRoute);
    });
    if (!this.isCurrent(job)) return;
    if (this.channel === 'qqbot') {
      this.saveProject(job.projectRoot, credentials.appId);
    }
    clearTimeout(job.timer); job.waitingForConnection = true;
    if (this.channel === 'qqbot') { job.state = 'pairing'; job.message = '机器人已保存。请在QQ发一句话，再填入收到的配对码，确认你的帐号。'; }
    for (let i = 0; i < 30 && this.isCurrent(job); i++) {
      const status = await this.status();
      if (status.accounts.some(account => account.connected && account.routeReady)) {
        if (this.channel === 'feishu') { job.state = 'connected'; job.message = '飞书已连接到学习模式。'; job.waitingForConnection = false; }
        return;
      }
      await delay(1000);
    }
    if (this.isCurrent(job) && this.channel === 'feishu') this.fail(job, '飞书应用已保存，但还没有接通。请检查机器人权限后重试。');
  }
  async verify(params) {
    if (this.channel !== 'qqbot') throw new Error('当前连接不需要配对码。');
    if (this.stopped || this.verifying) throw new Error('正在确认连接，请稍后再试。');
    this.verifying = true;
    try {
    const job = this.job;
    if (job && params?.id !== job.id) throw new Error('这次连接已经更新，请刷新后重试。');
    if (job && !['pairing', 'connected'].includes(job.state)) throw new Error('当前没有等待帐号确认的QQ连接。');
    const code = typeof params?.code === 'string' ? params.code.trim().toUpperCase() : '';
    if (!/^[A-Z0-9]{6,12}$/.test(code)) throw new Error('请输入QQ机器人发来的配对码。');
    const root = this.requireProject(params.projectRoot || this.readProject());
    if (root !== this.readProject()) throw new Error('这个QQ连接已选择了另一个项目，请使用原项目目录。');
    const appId = this.account()?.appId;
    if (!appId || this.account()?.enabled === false) throw new Error('请先连接QQ机器人。');
    const request = (await this.listRequests()).find(item => item.code === code && item.meta?.accountId === this.accountId && item.meta?.pinkieAppId === appId);
    if (!request) throw new Error('配对码没有找到或已过期，请在QQ里重新发一句话。');
    const route = this.route(this.config(), request.id);
    if (!route) throw new Error('QQ项目模式路由与已有设置冲突。');
    this.bindProject(route.sessionKey, root);
    if (this.stopped || this.job !== job) throw new Error('连接服务正在更新，请稍后再试。');
    if (!await this.approve(code)) throw new Error('配对码已过期，请重新获取。');
    await this.mutate(draft => {
      const account = draft.channels?.qqbot?.accounts?.[this.accountId];
      if (this.stopped || this.job !== job || account?.appId !== appId || !this.route(draft, request.id)) throw new Error('QQ应用信息已更新，请刷新后重试。');
      account.allowFrom = [...new Set([...(account.allowFrom || []).filter(id => typeof id === 'string' && id !== '*'), request.id])];
    });
    if (job) { job.state = 'pairing'; job.waitingForConnection = true; job.message = 'QQ帐号已确认，正在接通项目模式…'; }
    return this.status();
    } finally { this.verifying = false; }
  }
  async cancel(params) {
    if (this.verifying) throw new Error('正在确认QQ帐号，请稍等。');
    const job = this.job;
    if (!job || params?.id !== job.id) throw new Error('这次连接已经结束，请刷新状态。');
    if (job.state === 'finishing') throw new Error('正在完成连接，请稍等。');
    this.fail(job, '已取消连接。', 'cancelled');
    return this.status();
  }
  async disconnect(params) {
    if (this.verifying) throw new Error('正在确认QQ帐号，请稍等。');
    if (params?.accountId !== this.accountId || !this.account()) throw new Error('没有找到这次连接。');
    if (this.job?.state === 'finishing') throw new Error('正在完成连接，请稍等。');
    if (this.job && ACTIVE.has(this.job.state)) this.fail(this.job, '已断开连接。', 'cancelled');
    await this.mutate(draft => { const account = draft.channels?.[this.channel]?.accounts?.[this.accountId];
      if (account) account.enabled = false; });
    return this.status();
  }
  stop() { this.stopped = true; if (this.job && ACTIVE.has(this.job.state)) this.fail(this.job, '连接服务已更新，请重新连接。', 'cancelled'); }
}
