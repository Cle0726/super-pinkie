// Metre 把活派给外部引擎（briefs/metre-engines-1122 PLAN 3.4，E4）：工具 pinkie_engine_task。
//
// 一件外部活 = Metre 父会话下面的一个子会话（agent:metre:pinkie-child:…），血缘里记 kind: 'external'，
// 引擎台按这个子会话记的引擎和对话来画（engines-bridge.mjs 的 sessions.json），所以侧栏、总谱、点开就是它的引擎台，都用现成的。
// 开对话走 orchestration.launchThread（不等它做完）；插件每 5 秒看一次在跑的外部子任务，做完、没做成、等人回答时
// 用血缘现有的汇报卡片和叫醒链条（SessionLineage.report / defer）回报 Metre。在跑的外部子任务算进 Metre 的在跑上限。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {getActiveMetreLock} from './metre-lock.mjs';
import {boundProjectRoot} from './project-brief.mjs';
import {isMetreKey} from './session-lineage.mjs';
import {clipGraphemes, numberedTitle, sessionTool} from './session-titles.mjs';

export const TICK_MS = 5000;
const PER_TURN = 6;          // 和 pinkie_session_start 一样：一轮最多自己开 6 个
const FIRST_RUN_GRACE = 90_000; // 刚开的对话还没起跑（引擎在准备工作区）的宽限
const MAX_MISSES = 12;       // 连着这么多次读不到对话（约 1 分钟）就当没做成
// 放手程度四档（engines-bridge.mjs 的 LEVELS；这里不能 import 它：engines.mjs 和桥互相引用，会读到还没初始化的值）。
const LEVEL_IDS = new Set(['full-access', 'auto', 'auto-accept-edits', 'approval-required']);
const REPORT_NOTE = '\n\n做完后用几句话交回：做了什么、改了哪些文件、怎么验证的、还剩什么。';
const clip = (text, n) => clipGraphemes(String(text ?? '').trim(), n);
const firstLine = text => String(text || '').split(/\r?\n/).map(line => line.trim()).find(Boolean) || '';
const childKey = (parentKey, seed) => `agent:metre:pinkie-child:${crypto.createHash('sha256').update(JSON.stringify([parentKey, seed])).digest('hex').slice(0, 32)}`;

export const ENGINE_TASK_TEXT = '把一块能独立做完的编码活交给外部编码引擎（Claude Code、Codex、Antigravity、Cursor 等，用的是用户自己登录的账号和额度），'
  + '它在侧栏你的会话下面单独一行、用户点开就是它的引擎台（看得到每条命令和改动、停得了）；做完、没做成或等用户回答时，汇报自动送回并叫醒你，不要轮询。'
  + 'action：engines 先看哪些引擎和模型现在能用；start（默认）开一件活，写 engine（engines 返回的 id）、task（简报：目标、文件路径、做到什么样算完、怎么验证；它看不到这段对话）、'
  + '可选 model（不写用那家的默认）、title、folder（绝对路径，不写跟你绑定的项目）、level（full-access 全放手 / auto 自己判断 / auto-accept-edits 改文件不问 / approval-required 每步都问，默认全放手）；'
  + 'player 可选：写用户存的乐手名字（engines 会列出），就用它的引擎、模型、放手程度和角色；'
  + 'say 给在做的那件递一句话（target 写 start 返回的 key，text 写话）；stop 叫它停；show 看它此刻的状态和最后的回话。'
  + '和 pinkie_session_start 共用在跑上限和一次请求的上限。额度用完的引擎不要选；用户没打开外部引擎时这个工具不出现。';

// 引擎此刻在做什么，给总谱声部和侧栏用（短短几个字）。
export function doingOf(summary) {
  const items = summary?.items || [];
  const last = [...items].reverse().find(item => !['you', 'note'].includes(item.kind));
  if (!last) return '准备中';
  if (last.kind === 'command') return clip('跑 ' + firstLine(last.command), 40);
  if (last.kind === 'edit') return clip('改 ' + path.basename(String(last.file || '')), 40);
  if (last.kind === 'thinking') return '想';
  if (last.kind === 'reply') return last.streaming ? '写回话' : '回话';
  if (last.kind === 'search' || last.kind === 'web') return '搜';
  if (last.kind === 'tool') return clip('用 ' + last.name, 40);
  if (last.kind === 'todo') return '排计划';
  if (last.kind === 'approval') return '等你批准';
  if (last.kind === 'question') return '等你回答';
  return '在做';
}

// 交回的话：最后一段回话 + 改了哪些文件。没做成的写原因。
export function reportOf(summary, {engineName = '', status = ''} = {}) {
  const items = summary?.items || [];
  const reply = [...items].reverse().find(item => item.kind === 'reply' && String(item.text || '').trim());
  const files = (summary?.changes || []).map(row => row.counted ? `${row.file}（+${row.additions} −${row.deletions}）` : row.file);
  const changed = files.length ? `\n\n改了：${files.slice(0, 20).join('、')}${files.length > 20 ? ` 等 ${files.length} 个文件` : ''}` : '';
  if (status === 'failed') {
    const why = summary?.error?.text || [...items].reverse().find(item => item.kind === 'error')?.text || '引擎没说原因';
    return `${engineName || '外部引擎'}没做成：${why}${summary?.error?.resetAt ? `（${summary.error.resetAt} 恢复）` : ''}${reply ? `\n\n它最后说：${clip(reply.text, 2000)}` : ''}${changed}`;
  }
  if (status === 'stopped') return `${engineName || '外部引擎'}停下了，这件活没做完。${reply ? `\n\n停之前它说：${clip(reply.text, 2000)}` : ''}${changed}`;
  return `${reply ? clip(reply.text, 6000) : `${engineName || '外部引擎'}做完了，没有写回话。`}${changed}`;
}

export class EngineTasks {
  constructor({bridge, lineage = null, players = null, isEnabled = () => true, ensureRunning = async () => {}, now = () => Date.now(), schedule = setTimeout, logger = null} = {}) {
    Object.assign(this, {bridge, lineage, players, isEnabled, ensureRunning, now, schedule, logger});
    this.live = new Map();   // 子会话 key → {status, doing, misses, since}
    this.busyKeys = new Set();
    this.timer = null;
    this.ticking = false;
  }

  records() {
    try { return Object.entries(this.lineage?.lineage?.() || {}).filter(([, record]) => record?.kind === 'external' && record.threadId); }
    catch { return []; }
  }
  watched() { return this.records().filter(([, record]) => record.engineWatch === true); }
  busy(key) { return this.busyKeys.has(key); }
  doing(key) { return this.busyKeys.has(key) ? this.live.get(key)?.doing || '' : ''; }

  // 网关重启后：还没交回的照样守着，先当在跑（占名额），第一次读到再改。
  boot() {
    for (const [key] of this.watched()) this.busyKeys.add(key);
    this.kick();
  }

  kick(ms = TICK_MS) {
    if (this.timer || !this.watched().length) return;
    this.timer = this.schedule(() => { this.timer = null; void this.tick().finally(() => this.kick()); }, ms);
    this.timer?.unref?.();
  }

  // 侧栏、总谱要的：哪些 Metre 会话在用外部引擎、子任务此刻在不在跑。
  async sessionsView() {
    const prefs = this.bridge.sessions.all();
    let names = new Map(), models = new Map();
    try {
      const {engines} = await this.bridge.catalog();
      names = new Map(engines.map(row => [row.id, row.name]));
      models = new Map(engines.flatMap(row => row.models.map(model => [`${row.id}\0${model.slug}`, model.name])));
    } catch {}
    const records = Object.fromEntries(this.records());
    const sessions = {};
    for (const [key, pref] of Object.entries(prefs)) {
      if (!isMetreKey(key) || !pref?.engine || pref.engine === 'metre') continue;
      const record = records[key];
      const name = names.get(pref.engine) || record?.engineName || pref.engine;
      sessions[key] = {engine: pref.engine, name, model: pref.model || '', modelName: models.get(`${pref.engine}\0${pref.model}`) || record?.modelName || pref.model || '',
        task: Boolean(record), ...(record?.player ? {player: record.player} : {}), ...(record ? {status: this.busy(key) ? 'running' : this.live.get(key)?.status || record.engineStatus || '', doing: this.doing(key)} : {})};
    }
    return {sessions};
  }

  async readyEngines() {
    const {engines} = await this.bridge.catalog();
    return engines.map(row => ({id: row.id, name: row.name, state: row.state, text: row.text, plan: row.plan || '',
      quota: row.quota?.state === 'out' ? `额度用完了${row.quota.resetAt ? `，${row.quota.resetAt} 恢复` : ''}` : row.quota?.text || '',
      models: row.models.map(model => ({id: model.slug, name: model.name, ...(model.isDefault ? {default: true} : {}), ...(model.out ? {out: '额度用完了'} : {})}))}));
  }

  child(parentKey, target) {
    const key = String(target || '').trim();
    const record = this.lineage.lineage()[key];
    if (!record || record.kind !== 'external' || record.parentKey !== parentKey) throw new Error('target 要写 pinkie_engine_task start 返回的 key（只能是你自己派出去的外部活）');
    return {key, record};
  }

  // ---- 工具 ----
  async run(parentKey, runId, params = {}) {
    const action = String(params.action || 'start');
    if (!isMetreKey(parentKey)) throw new Error('只有 Metre 能把活派给外部引擎');
    if (action === 'engines') {
      await this.ensureRunning();
      const players = (this.players?.list() || []).map(row => ({name: row.name, engine: row.engine, model: row.model, level: row.level, ...(row.role ? {role: row.role} : {})}));
      return {engines: await this.readyEngines(), ...(players.length ? {players} : {})};
    }
    if (action === 'say') {
      const {key, record} = this.child(parentKey, params.target);
      const text = String(params.text || '').trim();
      if (!text) throw new Error('text 写要递的话');
      await this.ensureRunning();
      const summary = await this.bridge.send({threadId: record.threadId, text: text.slice(0, 12_000), mode: 'queue'});
      this.watch(key, {engineAsked: ''});
      return {target: key, status: summary.status, message: '话递过去了。做完会再交回汇报、叫醒你'};
    }
    if (action === 'stop') {
      const {key, record} = this.child(parentKey, params.target);
      await this.bridge.stop({threadId: record.threadId});
      this.kick(1000);
      return {target: key, message: '已经叫它停下'};
    }
    if (action === 'show') {
      const {key, record} = this.child(parentKey, params.target);
      const summary = await this.bridge.thread(record.threadId);
      return {target: key, title: record.title, engine: record.engineName, model: record.model, status: summary.status, doing: doingOf(summary),
        lastReply: clip([...summary.items].reverse().find(item => item.kind === 'reply')?.text || '', 2000),
        changes: summary.changes.map(row => row.file), waiting: summary.pending.length > 0};
    }
    if (action !== 'start') throw new Error('action 只能是 engines、start、say、stop、show');
    return this.start(parentKey, runId, params);
  }

  async start(parentKey, runId, params) {
    const lineage = this.lineage;
    if (!this.isEnabled()) throw new Error('用户还没打开外部引擎：这件活改用 pinkie_session_start 派，或者就在这里做');
    if (lineage.solo(parentKey)) throw new Error('这个会话现在是 Virtuoso（独做）：不派活，自己做');
    if (lineage.paused(parentKey)) throw new Error('用户暂停了派发：已经在跑的照常，新的先不开');
    const task = String(params.task || params.prompt || '').trim();
    if (!task || task.length > 16_000) throw new Error('task 写简报（最多 16000 字）：目标、文件路径、做到什么样算完、怎么验证');
    await lineage.parentEntry(parentKey);
    // 乐手（E5）：写了 player 就用它的引擎、模型、放手程度和角色卡；engine / model / level 另写了的以另写的为准。
    let player = null;
    if (params.player) {
      player = this.players?.find(params.player);
      if (!player) throw new Error(`没有「${clip(params.player, 24)}」这个乐手${this.players?.list().length ? `：现有 ${this.players.list().map(row => row.name).join('、')}` : '（用户还没存过乐手）'}`);
      // 另写了别的引擎：乐手的模型是那一家的，不带过去。
      const sameEngine = !params.engine || params.engine === player.engine;
      params = {...params, engine: params.engine || player.engine, model: params.model || (sameEngine ? player.model : ''), level: params.level || player.level};
    }
    const turn = lineage.turns.get(parentKey);
    const wake = Boolean(turn?.wake) && !['memory', 'heartbeat'].includes(turn?.trigger);
    if (!wake && !turn?.resumedUser && (!turn || turn.internal || !turn.user)) throw new Error('这一轮不是用户亲自发来的，不能自己派活');
    if ((turn?.autoStarts || 0) >= PER_TURN) throw new Error(`一轮最多自己开 ${PER_TURN} 个子会话，其余的排在这里做`);
    const cap = lineage.metreLimits().requestCap, used = lineage.state(parentKey).metreStarts || 0;
    if (cap > 0 && used >= cap) throw new Error(`这次请求已经开了 ${used} 个子会话，到了上限（${cap}）。先停下来把进展告诉用户，等用户回话`);
    const limit = lineage.maxRunning(parentKey);
    if (lineage.runningChildren(parentKey, await lineage.familyRows(parentKey)) >= limit) throw new Error(`这个父会话已有 ${limit} 个子会话在跑，等一个做完再开始`);

    await this.ensureRunning();
    const engines = await this.readyEngines();
    const engine = engines.find(row => row.id === String(params.engine || ''));
    if (!engine) throw new Error(`没有「${clip(params.engine, 40)}」这个引擎：先用 action: engines 看能用的，engine 写它的 id`);
    if (engine.state !== 'ready') throw new Error(`${engine.name}现在用不了（${engine.text || '还没设置好'}）：换一个能用的，或者告诉用户去引擎菜单里设置`);
    if (/额度用完/.test(engine.quota)) throw new Error(`${engine.name}${engine.quota}：换一个引擎`);
    const model = params.model ? engine.models.find(row => row.id === String(params.model)) : engine.models.find(row => row.default) || engine.models[0];
    if (!model) throw new Error(params.model ? `${engine.name}没有「${clip(params.model, 60)}」这个模型：写 engines 返回的模型 id` : `${engine.name}没有报上来能用的模型`);
    if (model.out) throw new Error(`${engine.name}的「${model.name}」额度用完了：换一个模型`);
    const level = LEVEL_IDS.has(params.level) ? params.level : 'full-access';

    let folder = '';
    if (params.folder) {
      folder = path.resolve(String(params.folder));
      if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error(`文件夹不存在：${clip(params.folder, 200)}`);
    } else folder = boundProjectRoot(parentKey, {stateRoot: this.bridge.stateRoot}) || this.bridge.folderFor(parentKey);

    const title = clip(params.title || firstLine(task), 40) || '外部引擎的活';
    const role = player?.role ? this.roleBrief(player.role) : '';
    const key = childKey(parentKey, [runId || '', crypto.randomUUID()]);
    let label = '';
    for (let ordinal = 1; ordinal <= 50 && !label; ordinal++) {
      const candidate = numberedTitle(title, ordinal, 40);
      try {
        const result = await lineage.access.rpc('sessions.create', {agentId: 'metre', key, label: candidate, parentSessionKey: parentKey});
        if (result?.key !== key) throw new Error('网关没有建出子会话');
        label = result.entry?.label || candidate;
      } catch (error) { if (!/label already in use/i.test(error.message)) throw error; }
    }
    if (!label) throw new Error('找不到可用的子会话名称');
    let started;
    try {
      await lineage.access.rpc('pinkie.project.bind', {key, path: folder, name: path.basename(folder) || folder});
      started = await this.bridge.start({folder, engine: engine.id, model: model.id, text: role + task + REPORT_NOTE, level, title: label});
      if (!started.threadId) throw new Error('引擎没有开出对话');
    } catch (error) {
      await lineage.access.rpc('sessions.delete', {key, agentId: 'metre', deleteTranscript: true}).catch(() => null);
      throw new Error(`没交出去：${error.message}`);
    }
    this.bridge.sessions.set(key, {engine: engine.id, model: model.id, level, plan: false, threadId: started.threadId, folder, task: true, parentKey});
    lineage.updateLineage(key, {parentKey, title: label, initiation: 'in_scope', context: 'fresh', createdAt: this.now(), detached: false, lastReportAt: 0,
      started: true, kind: 'external', engine: engine.id, engineName: engine.name, model: model.id, modelName: model.name, level, folder,
      threadId: started.threadId, ...(player ? {player: player.name, playerId: player.id, ...(player.role ? {metreRolePersona: player.role} : {})} : {}), engineWatch: true, engineSince: this.now(), engineStatus: 'running', engineAsked: '', engineReported: ''});
    try { lineage.titles?.record?.(key, {title: label, source: 'system'}); } catch {}
    if (turn) turn.autoStarts = (turn.autoStarts || 0) + 1;
    lineage.countMetreStart(parentKey);
    this.busyKeys.add(key);
    this.live.set(key, {status: 'running', doing: '准备中', misses: 0, since: this.now()});
    lineage.notify(parentKey);
    lineage.notify(key);
    this.kick(2000);
    const slots = await lineage.slotsLeft(parentKey);
    return {key, title: label, engine: engine.id, engineName: engine.name, model: model.id, ...(player ? {player: player.name} : {}), ...(slots === undefined ? {} : {slotsLeft: slots}),
      message: `已经交给 ${engine.name}（${model.name}）开始做了。做完、没做成或等用户回答时汇报会送回并叫醒你；不要轮询，也不要自己把同一块再做一遍`};
  }

  // 乐手带的 Metre 角色卡：放在简报前面当这件活的角色说明（引擎看不到 Metre 的角色系统，只能写进话里）。
  roleBrief(id) {
    try {
      const card = this.lineage.rolesRegistry?.().byId?.[id];
      if (!card?.body) return '';
      return `【这件活里你的角色：${card.name || id}】
${clip(card.body, 6000)}

【要做的事】
`;
    } catch { return ''; }
  }

  watch(key, patch = {}) {
    this.lineage.updateLineage(key, {engineWatch: true, engineSince: this.now(), engineStatus: 'running', ...patch});
    this.busyKeys.add(key);
    this.live.set(key, {...this.live.get(key), status: 'running', misses: 0, since: this.now()});
    this.kick(2000);
  }

  // ---- 守望 ----
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try { for (const [key, record] of this.watched()) await this.check(key, record).catch(error => this.logger?.warn?.(`engine task ${key}: ${error.message}`)); }
    finally { this.ticking = false; }
  }

  async check(key, record) {
    const lineage = this.lineage;
    const live = this.live.get(key) || {status: 'running', misses: 0, since: record.engineSince || record.createdAt || this.now()};
    this.live.set(key, live);
    // 用户点了「全体收住」：这件外部活也停。
    const stop = lineage.state(record.parentKey).lastStop;
    if (stop?.at > (record.engineSince || 0) && !record.engineStopAsked) {
      lineage.updateLineage(key, {engineStopAsked: true});
      await this.bridge.stop({threadId: record.threadId}).catch(() => null);
    }
    let summary;
    try {
      if (!this.bridge.service.status().running) throw new Error('外部引擎停了');
      summary = await this.bridge.thread(record.threadId);
      live.misses = 0;
    } catch (error) {
      live.misses = (live.misses || 0) + 1;
      if (live.misses < MAX_MISSES) return;
      return this.finish(key, record, null, 'failed', `${record.engineName || '外部引擎'}没做成：${error.message}`);
    }
    live.doing = doingOf(summary);
    const status = summary.status;
    if (status === 'running' || (status === 'idle' && this.now() - (record.engineSince || 0) < FIRST_RUN_GRACE)) {
      live.status = 'running';
      this.busyKeys.add(key);
      if (lineage.state(key).phase === 'waiting') { lineage.updateState(key, state => ({...state, phase: undefined, at: this.now()})); lineage.notify(record.parentKey); }
      return;
    }
    if (status === 'waiting') {
      live.status = 'waiting';
      this.busyKeys.delete(key);
      const ask = summary.pending[0]?.requestId || 'ask';
      if (record.engineAsked === ask) return;
      const item = summary.items.find(row => row.requestId === ask);
      const what = item?.kind === 'approval' ? `等你批准：${clip(item.prompt, 600)}` : item?.kind === 'question'
        ? `有问题要你回答：${clip(item.questions.map(question => question.question).join('；'), 600)}` : '在等你';
      lineage.updateLineage(key, {engineAsked: ask, engineStatus: 'waiting'});
      lineage.updateState(key, state => ({...state, phase: 'waiting', at: this.now()}));
      await lineage.report(key, {...record, engineAsked: ask}, `${record.engineName || '外部引擎'}${what}\n\n请用户点开侧栏里这件活，在它的引擎台里回答；回答以后它会接着做。`, `engine-ask-${ask}`);
      lineage.defer(record.parentKey);
      lineage.notify(record.parentKey);
      return;
    }
    const run = summary.runId || summary.runCompletedAt || 'run';
    const final = status === 'failed' ? 'failed' : status === 'stopped' ? 'stopped' : status === 'idle' ? 'failed' : 'done';
    if (record.engineReported === run) { lineage.updateLineage(key, {engineWatch: false}); this.busyKeys.delete(key); return; }
    const text = status === 'idle' ? `${record.engineName || '外部引擎'}没跑起来：开了对话，过了 ${Math.round(FIRST_RUN_GRACE / 1000)} 秒还没开始做` : reportOf(summary, {engineName: record.engineName, status: final});
    return this.finish(key, record, run, final, text);
  }

  async finish(key, record, run, final, text) {
    const lineage = this.lineage;
    this.busyKeys.delete(key);
    this.live.set(key, {...this.live.get(key), status: final, doing: ''});
    lineage.updateLineage(key, {engineWatch: false, engineStatus: final, engineReported: run || `miss-${this.now()}`});
    lineage.updateState(key, state => ({...state, phase: final === 'failed' ? 'error' : undefined, at: this.now()}));
    await lineage.report(key, record, text, `engine-${run || this.now()}`, {failed: final === 'failed'});
    lineage.defer(record.parentKey);
    lineage.notify(record.parentKey);
    lineage.notify(key);
  }
}

// 每个运行时都要注册一次工具和钩子（宿主按运行时各加载一份插件），任务和守望用同一个实例。
export function registerEngineTasks(api, {tasks, register}) {
  const lineage = tasks.lineage;
  // 外部子任务在跑时算「忙」：在跑上限、看门狗等子会话、总谱的「在奏」都读这个。
  lineage.externalBusy = key => tasks.busy(key);
  lineage.externalDoing = key => tasks.doing(key);
  // 用户在这件活的引擎台或总谱里递了话：它会接着做，做完再交回一次。
  tasks.bridge.afterSay = key => { if (lineage.lineage()[key]?.kind === 'external') tasks.watch(key, {engineAsked: ''}); };
  tasks.apis ??= new WeakSet();
  if (api && typeof api === 'object') { if (tasks.apis.has(api)) return tasks; tasks.apis.add(api); }
  const locked = () => Boolean(getActiveMetreLock()?.isLocked?.());
  api.registerTool?.(ctx => {
    const key = String(ctx?.sessionKey || '');
    if (!isMetreKey(key) || locked() || lineage.solo(key) || !tasks.isEnabled() || lineage.lineage()[key]) return null;
    return sessionTool('pinkie_engine_task', ENGINE_TASK_TEXT,
      {action: {type: 'string', enum: ['engines', 'start', 'say', 'stop', 'show']}, engine: {type: 'string'}, model: {type: 'string'},
        task: {type: 'string'}, title: {type: 'string'}, folder: {type: 'string'}, level: {type: 'string', enum: [...LEVEL_IDS]},
        target: {type: 'string'}, text: {type: 'string'}, player: {type: 'string'}}, [],
      params => { getActiveMetreLock()?.assertUnlocked?.(); return tasks.run(key, ctx.runId || lineage.turns.get(key)?.runId, params); });
  }, {name: 'pinkie_engine_task'});
  // 外部子任务不是 Metre 自己的会话：给它发 pinkie_session_message 会在里面跑一轮 Metre，改成递给引擎。
  api.on?.('before_tool_call', (event, ctx) => {
    try {
      if (String(event?.toolName || event?.name || '') !== 'pinkie_session_message') return undefined;
      const target = String(event?.params?.target ?? event?.params?.session ?? '');
      if (lineage.lineage()[target]?.kind !== 'external') return undefined;
      return {block: true, blockReason: '这是交给外部引擎的活：用 pinkie_engine_task（action: say，target 写它的 key）给它递话'};
    } catch { return undefined; }
  });
  register(api, 'pinkie.engines.sessions', () => tasks.sessionsView());
  if (!tasks.booted) { tasks.booted = true; tasks.boot(); }
  return tasks;
}
