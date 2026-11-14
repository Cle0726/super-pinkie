import {randomUUID} from 'node:crypto';
import {waitingItems} from './work-kinds.mjs';

// 后台命令守望。OpenClaw 自带的「后台命令结束就叫醒」走心跳：只有默认智能体开着心跳，
// 而且心跳回复默认不进聊天记录（2026-10-25 实测：项目模式完全没被叫醒；唠嗑模式被叫醒了，
// 回复却被当成心跳丢掉）。所以碧琪自己盯着：exec 返回「Command still running (session X, pid N)」
// 后记下进程，进程一结束，就用一条聊天里看不见的内部消息把碧琪叫起来接着做，回复照常进聊天。
const RUNNING = /Command still running \(session ([\w.-]+), pid (\d+|n\/a)\)/;
const EXITED = /Process exited with (?:code|signal)/;
const POLL_MS = 3_000;
const MAX_WATCH_MS = 6 * 60 * 60_000;
export const WAKE_PREFIX = '[pinkie-tier] 后台任务完成';
const SESSION_KEY = /^agent:(main|project|thinking|learning|unrestricted|metre):[^\s]+$/;
const STATE = Symbol.for('pinkie.backgroundJobs.v1');

function resultText(result) {
  if (typeof result === 'string') return result;
  const content = result?.content ?? result?.output ?? result;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('\n');
  try { return JSON.stringify(content ?? ''); } catch { return ''; }
}

function alive(pid) {
  if (!(pid > 0)) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

export function wakeMessage(job) {
  const seconds = Math.max(1, Math.round(((job.endedAt || Date.now()) - job.startedAt) / 1000));
  return `${WAKE_PREFIX}：你之前放到后台的命令已经结束（exec 会话 ${job.execId}，用时约 ${seconds} 秒，命令：${job.command.slice(0, 300)}）。`
    + '先用 process 工具的 log 动作读取它的完整输出，确认成功还是失败；失败就照打法找原因、修好重跑。'
    + '成功了就把等它的时候做好的部分合进来，补上交付前的亲眼验证（打开文件看、抽帧、截图），还有别的长命令要跑就接着放后台、继续做不依赖它的事；'
    + '最后把真实结果告诉用户。'
    + '这条消息由系统自动发出，用户看不到，回复里不要提到它。';
}

// 后台命令还在跑时，小模型常连着 poll / log / sleep / ps 干等（11-04 隔离实测：渲染放后台后
// log → poll 25 秒 → log → ps → poll 25 秒 → ls → poll 25 秒）。系统提示里的规则它看过就忘，
// 所以在它第二次连着「等」的那一刻拦下来，把这件活的等待清单直接当成工具结果给它。
const WAIT_ACTIONS = new Set(['poll', 'log', 'list']);
const WAIT_SEGMENT = /^\s*(?:sleep\s+\d|ps\b|pgrep\b|ls\b|du\b|tail\b|wc\b|stat\b|grep\b|cat\s+\S*\.(?:log|txt)\b|echo\b|true\b)/;
const MAX_BLOCKED_WAITS = 4;

export function rememberKinds(sessionKey = '', kinds = []) {
  const shared = globalThis[STATE] ||= {jobs: new Map(), timer: null};
  shared.kinds ||= new Map();
  if (sessionKey && kinds.length) shared.kinds.set(sessionKey, [...kinds]);
}

function waitingCall(name, params = {}) {
  if (name === 'process') return WAIT_ACTIONS.has(String(params.action || ''));
  if (!/(?:^|_)exec$/.test(name)) return false;
  const command = String(params.command || params.cmd || '').trim();
  return Boolean(command) && command.split(/&&|\|\||;|\|/).every((part) => !part.trim() || WAIT_SEGMENT.test(part));
}

export function waitNudge(jobs = [], kinds = [], now = Date.now()) {
  const list = jobs.slice(0, 3).map((job) => `「${String(job.command || '').replace(/\s+/g, ' ').slice(0, 80)}」（已跑约 ${Math.max(1, Math.round((now - job.startedAt) / 1000))} 秒）`).join('、');
  return `${list}还在后台跑，跑完系统会自动叫你，不用再查。现在先做不依赖它的事：`
    + waitingItems(kinds).map((item, i) => `${i + 1}）${item}`).join('；')
    + '。真的一件都不剩了，就用一句话告诉先生在跑什么、大概要多久，然后结束这一轮。';
}

// 只读：这个会话里还在跑的后台命令（新的一轮开始时告诉碧琪「还有这些在跑」）。不新建守望实例。
export function runningBackgroundJobs(sessionKey = '') {
  const jobs = globalThis[STATE]?.jobs;
  if (!jobs || !sessionKey) return [];
  return [...jobs.values()].filter((job) => job.sessionKey === sessionKey && job.state === 'running');
}

export class BackgroundJobs {
  constructor({runProcess = null, cliEntry = '', isBusy = () => false, now = () => Date.now(), alive: isAlive = alive, pollMs = POLL_MS} = {}) {
    // 同一个网关进程里插件会被加载成几份（网关方法一份、运行时钩子一份），守望表必须只有一份。
    const shared = globalThis[STATE] ||= {jobs: new Map(), timer: null};
    this.shared = shared;
    this.runProcess = runProcess;
    this.cliEntry = cliEntry;
    this.isBusy = isBusy;
    this.now = now;
    this.alive = isAlive;
    this.pollMs = pollMs;
    shared.owner ||= this;
  }

  get jobs() { return this.shared.jobs; }

  // before_tool_call：后台命令还在跑、又连着第二次「等」→ 拦下，改成等待清单。干别的就清零。
  // 刚放到后台、中间一件别的事都没做就去等，第一次也拦（11-04 隔离实测 routes-m R-ad 两遍都是
  // exec 转后台 → 紧接着 poll，评审两遍都扣「干等」）。
  beforeTool(event = {}, ctx = {}) {
    const sessionKey = String(ctx.sessionKey || '');
    if (!SESSION_KEY.test(sessionKey) || /^agent:unrestricted:/.test(sessionKey) || /:(?:subagent|internal-session-effects):/.test(sessionKey)) return null;
    const shared = this.shared;
    shared.waitStreak ||= new Map();
    shared.idleSinceStart ||= new Map();
    const running = this.runningFor(sessionKey);
    const name = String(event.toolName || '').toLowerCase();
    const waiting = waitingCall(name, event.params || {});
    if (!waiting) shared.idleSinceStart.delete(sessionKey);
    if (!running.length || !waiting) { shared.waitStreak.delete(sessionKey); return null; }
    const startedJob = shared.idleSinceStart.get(sessionKey);
    if (startedJob && running.some((job) => job.id === startedJob)) {
      shared.idleSinceStart.delete(sessionKey);
      shared.waitStreak.set(sessionKey, 1);
      return {block: true, blockReason: waitNudge(running, shared.kinds?.get(sessionKey) || [], this.now())};
    }
    shared.idleSinceStart.delete(sessionKey);
    const streak = (shared.waitStreak.get(sessionKey) || 0) + 1;
    shared.waitStreak.set(sessionKey, streak);
    if (streak < 2 || streak > MAX_BLOCKED_WAITS + 1) return null;
    return {block: true, blockReason: waitNudge(running, shared.kinds?.get(sessionKey) || [], this.now())};
  }

  // after_tool_call：exec 转后台就登记；process 读到结束就算碧琪自己已经知道了，不必再叫醒。
  afterTool(event = {}, ctx = {}) {
    const sessionKey = String(ctx.sessionKey || '');
    if (!SESSION_KEY.test(sessionKey) || /:(?:subagent|internal-session-effects):/.test(sessionKey)) return null;
    const name = String(event.toolName || '').toLowerCase();
    const output = resultText(event.result);
    if (/(?:^|_)exec$/.test(name)) {
      const match = output.match(RUNNING);
      if (!match) return null;
      const job = {
        id: `bg-${randomUUID().slice(0, 8)}`, sessionKey, agentId: sessionKey.split(':')[1], execId: match[1],
        pid: Number(match[2]) || 0, command: String(event.params?.command || event.params?.cmd || ''),
        state: 'running', startedAt: this.now(), endedAt: 0, seenByAgent: false, woke: false,
      };
      this.jobs.set(job.id, job);
      (this.shared.idleSinceStart ||= new Map()).set(sessionKey, job.id);
      this.ensureTimer();
      return job;
    }
    if (name === 'process') {
      const execId = String(event.params?.sessionId || '');
      const action = String(event.params?.action || '');
      const status = String(event.result?.details?.status || '');
      const exited = ['completed', 'failed'].includes(status) || EXITED.test(output) || ['kill', 'remove'].includes(action);
      if (!execId || !exited) return null;
      for (const job of this.jobs.values()) {
        if (job.sessionKey !== sessionKey || job.execId !== execId || job.woke) continue;
        job.state = 'done';
        job.endedAt ||= this.now();
        job.seenByAgent = true;
      }
    }
    return null;
  }

  ensureTimer() {
    if (this.shared.timer) return;
    const owner = this.shared.owner || this;
    this.shared.timer = setInterval(() => { void owner.tick(); }, this.pollMs);
    this.shared.timer.unref?.();
  }

  async tick() {
    const now = this.now();
    let running = 0;
    for (const job of this.jobs.values()) {
      if (job.state === 'running') {
        if (job.pid && this.alive(job.pid) && now - job.startedAt < MAX_WATCH_MS) { running += 1; continue; }
        job.state = 'done';
        job.endedAt = now;
      }
      if (job.state === 'done' && !job.woke && !job.seenByAgent && !job.waking) {
        // 碧琪正在这个会话里忙（还在回答、子任务没收齐），先等它停下，再叫醒。
        if (this.isBusy(job.sessionKey)) { running += 1; continue; }
        job.waking = true;
        job.woke = await this.wake(job);
        job.waking = false;
        if (!job.woke) { job.wakeFailures = (job.wakeFailures || 0) + 1; if (job.wakeFailures >= 3) job.woke = true; else running += 1; }
      }
    }
    for (const [id, job] of this.jobs) if (job.state !== 'running' && now - (job.endedAt || now) > 30 * 60_000) this.jobs.delete(id);
    if (!running && this.shared.timer && ![...this.jobs.values()].some((job) => job.state === 'running' || (!job.woke && !job.seenByAgent))) {
      clearInterval(this.shared.timer);
      this.shared.timer = null;
    }
  }

  async wake(job) {
    if (!this.runProcess || !this.cliEntry) return false;
    try {
      const {stdout = ''} = await this.runProcess(process.execPath, [
        this.cliEntry, 'gateway', 'call', 'chat.send',
        '--params', JSON.stringify({sessionKey: job.sessionKey, agentId: job.agentId, message: wakeMessage(job), deliver: false, idempotencyKey: `pinkie-bg-${job.id}`}),
        '--json', '--timeout', '30000',
      ], {timeout: 35_000, maxBuffer: 64 * 1024, windowsHide: true, env: process.env});
      let result;
      try { result = JSON.parse(String(stdout).slice(String(stdout).indexOf('{'))); } catch {}
      return result?.status !== 'error' && result?.ok !== false;
    } catch {
      return false;
    }
  }

  // 这个会话里还在跑的后台命令（交付门禁据此放行「已在后台运行」）。
  runningFor(sessionKey) {
    return [...this.jobs.values()].filter((job) => job.sessionKey === sessionKey && job.state === 'running');
  }

  status(sessionKey) {
    return [...this.jobs.values()].filter((job) => job.sessionKey === sessionKey)
      .map(({id, execId, command, state, startedAt, endedAt, woke, seenByAgent}) => ({id, execId, command: command.slice(0, 160), state, startedAt, endedAt, woke: Boolean(woke || seenByAgent)}));
  }
}
