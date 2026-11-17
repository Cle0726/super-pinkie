// Metre 模式下后端的资源关停（briefs/metre-mode-1113 PLAN 2.13 后端部分，批 6）。
//
// 什么时候算「安静」：界面当前是 Metre（界面通过 pinkie.quiet.set 告诉这里，30 分钟不续就作废，免得界面关了还一直安静），
// 而且没有别的模式的会话在跑（Metre 派出去的子会话在学习模式里跑时，学习模式的东西照常）。
//
// 安静时停掉的，都是只为碧琪体验服务的：
//   - 心跳轮（trigger=heartbeat）：Metre 工作区本来就没有 HEARTBEAT.md，别的模式的心跳这时不跑。
//   - 学习提醒和约定（学习模式里带提醒标记的定时任务）：这时不跑。
//   - 学习资料后台任务的空转轮询（每半秒查一次库）：停掉；正在做的那一件做完为止，新的等离开 Metre 再接着排。
// 不停：网关、模型同步和健康、会话标题、看门狗、子会话调度、用户自己发起的轮。
// 消息渠道（微信、飞书、QQ）默认照常；设置里打开「Metre 模式下暂停消息渠道」后，安静时渠道发来的消息先不处理。
import fs from 'node:fs';
import path from 'node:path';
import {agentOf, registerSessionMethod} from './session-titles.mjs';

export const QUIET_TTL_MS = 30 * 60_000;
const APP_PROVIDERS = new Set(['', 'webchat', 'control-ui', 'internal', 'gateway', 'cli', 'pinkie']);

export class QuietMode {
  constructor({now = () => Date.now(), file = '', nudge = () => false} = {}) {
    this.now = now;
    this.file = file;
    this.nudge = nudge;
    this.until = 0;
    this.running = new Map();   // sessionKey → {count, at}：进行中的轮数（只算没被拦下的）和最近一次开始的时间
    this.services = new Map();  // 名字 → {pause, resume}
    this.paused = false;
    this.prefs = {pauseChannels: false};
    try { if (file) this.prefs = {...this.prefs, ...JSON.parse(fs.readFileSync(file, 'utf8'))}; } catch {}
    this.log = [];
  }

  uiQuiet() { return this.until > this.now(); }
  othersRunning() {
    // 三小时还没收到结束的当它丢了（别的钩子拦下的轮可能不发结束），不让它一直挡着。
    for (const [key, row] of this.running) if (row.count > 0 && agentOf(key) !== 'metre' && this.now() - row.at < 3 * 3600_000) return true;
    return false;
  }
  get active() { return this.uiQuiet() && !this.othersRunning(); }

  set(quiet) {
    this.until = quiet ? this.now() + QUIET_TTL_MS : 0;
    this.sync();
    return this.status();
  }
  setPrefs(patch = {}) {
    if (typeof patch.pauseChannels === 'boolean') this.prefs.pauseChannels = patch.pauseChannels;
    if (this.file) {
      try { fs.mkdirSync(path.dirname(this.file), {recursive: true}); fs.writeFileSync(this.file, JSON.stringify(this.prefs)); } catch {}
    }
    return this.status();
  }
  status() {
    return {ok: true, quiet: this.active, uiQuiet: this.uiQuiet(), othersRunning: this.othersRunning(), servicesPaused: this.paused,
      pauseChannels: this.prefs.pauseChannels, skipped: this.log.slice(-20)};
  }

  register(name, hooks) {
    this.services.set(name, hooks);
    if (this.paused) { try { hooks.pause?.(); } catch {} }
  }
  // 安静和不安静之间切换时，挨个暂停 / 恢复登记过的后台服务。
  sync() {
    const want = this.active;
    if (want === this.paused) return;
    this.paused = want;
    for (const [, hooks] of this.services) {
      try { (want ? hooks.pause : hooks.resume)?.(); } catch { /* 一个服务失败不影响别的 */ }
    }
  }

  // before_agent_run：安静时拦下心跳、学习提醒、（开了开关时）渠道消息；其余的轮照常，并记下谁在跑。
  gate(event = {}, ctx = {}) {
    const key = String(ctx.sessionKey || event.sessionKey || '');
    if (!agentOf(key)) return undefined;
    const trigger = String(ctx.trigger || event.trigger || '');
    if (this.active && agentOf(key) !== 'metre') {
      const provider = String(ctx.messageProvider || event.messageProvider || '').toLowerCase();
      let why = '';
      if (trigger === 'heartbeat') why = 'heartbeat';
      else if (trigger === 'cron' && agentOf(key) === 'learning' && this.nudge(event.prompt)) why = 'learning-nudge';
      else if (this.prefs.pauseChannels && !APP_PROVIDERS.has(provider)) why = 'channel:' + provider;
      if (why) {
        this.log.push({at: this.now(), why, sessionKey: key});
        if (this.log.length > 50) this.log.splice(0, this.log.length - 50);
        return {outcome: 'block', reason: 'pinkie-quiet', message: '现在在 Metre 模式里，这类后台活先不跑'};
      }
    }
    this.running.set(key, {count: (this.running.get(key)?.count || 0) + 1, at: this.now()});
    this.sync();
    return undefined;
  }
  ended(event = {}, ctx = {}) {
    const key = String(ctx.sessionKey || event.sessionKey || '');
    const row = this.running.get(key);
    if (row && row.count > 1) row.count -= 1; else this.running.delete(key);
    this.sync();
  }
}

export function registerQuietMode(api, {root, nudge} = {}) {
  const quiet = new QuietMode({file: root ? path.join(root, 'quiet-mode.json') : '', nudge});
  api.on?.('before_agent_run', (event, ctx) => {
    try { return quiet.gate(event, ctx); } catch { return undefined; }
  }, {priority: 10900});
  api.on?.('agent_end', (event, ctx) => { try { quiet.ended(event, ctx); } catch {} });
  registerSessionMethod(api, 'pinkie.quiet.set', ({quiet: on}) => quiet.set(on === true));
  registerSessionMethod(api, 'pinkie.quiet.status', () => quiet.status());
  registerSessionMethod(api, 'pinkie.quiet.prefs', params => quiet.setPrefs(params || {}));
  return quiet;
}
