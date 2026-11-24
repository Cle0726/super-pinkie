// 模型失败的真实原因 + 「换成哪个模型再发一次」。
//
// 聊天记录（chat.history）会把失败回复的 errorMessage 删掉，界面只剩一句「这次回复没能
// 完成，请稍后再试」，而上游其实说的是「没有可用账号」——等多久都不会好。这里在网关里
// 记下：
//   - 每个模型最近一次调用成没成功（model_call_started / model_call_ended）；
//   - 每个会话最近一次失败的那一轮：哪个模型、什么原因、归哪一类。
// 界面用 pinkie.model.failure 取回来，按原因说话，并给一个「换成 xx 再发一次」。

const ACCOUNT = /(?:auth[_ -]?unavailable|no auth available|no (?:available )?account|account unavailable|暂无账号|subscription.{0,32}(?:usage|quota).{0,24}limit|usage limit (?:exceeded|reached)|quota[ _-]+(?:exhausted|exceeded|depleted|reached)|insufficient[_ ]?(?:quota|balance|credits?)|billing|payment required|\b402\b|余额不足)/i;
const KEY = /(?:invalid[_ ]?api[_ ]?key|incorrect api key|unauthori[sz]ed|\b401\b)/i;
const MISSING = /(?:model[_ ]?not[_ ]?found|model (?:was |is )?not found|unknown model|unsupported model|no such model|model .{0,40}does not exist|模型.{0,60}不在.{0,30}(?:可用模型|范围)|不支持(?:该|这个)?模型)/i;
const BUSY = /(?:\b429\b|rate.?limit|too many requests|overloaded|\b529\b|server is busy)/i;
const TIMEOUT = /(?:timed? ?out|timeout|ETIMEDOUT|deadline exceeded)/i;
const NETWORK = /(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|network ?error|connection (?:reset|refused|closed))/i;
const DOWN = /(?:\b50[0234]\b|service unavailable|bad gateway|internal (?:server )?error|upstream)/i;

// 上游报错里带的恢复时间（E8-3，briefs/metre-engines-1122 PLAN 3.8）。只认说得清楚的几种写法，认不出就不写，
// 不猜：ISO 时间、Unix 秒 / 毫秒（Claude 的「usage limit reached|1764000000」、resets_at: 1764000000）、
// 「try again in 2 hours 30 minutes」「retry after 120s」「retry-after: 120」、「try again at 5:43 PM」、OpenClaw 的「ready in ~3 min」。
// 只要以后 31 天之内的时间；时钟时间按这台电脑的时区算，已经过了就算明天。
const UNIT = {d: 86_400_000, day: 86_400_000, days: 86_400_000, h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000,
  m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000, s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000};
const WHEN_WORD = '(?:resets?|reset[_ ]?at|resets[_ ]?at|retry|try again|available|ready|恢复)';
export function resetTime(reason = '', now = Date.now()) {
  const text = String(reason || '');
  if (!text) return null;
  const ok = at => (Number.isFinite(at) && at > now && at - now <= 31 * UNIT.d ? new Date(at).toISOString() : null);
  const iso = new RegExp(WHEN_WORD + '[^0-9]{0,40}(\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:?\\d{2})?)', 'i').exec(text);
  if (iso) return ok(Date.parse(iso[1].replace(' ', 'T')));
  const epoch = /limit reached\|(\d{10,13})\b/i.exec(text) || new RegExp(WHEN_WORD + '["\']?\\s*[:=]\\s*["\']?(\\d{10,13})\\b', 'i').exec(text);
  if (epoch) return ok(epoch[1].length === 13 ? Number(epoch[1]) : Number(epoch[1]) * 1000);
  const header = /retry[- ]after["']?\s*[:=]\s*["']?(\d{1,7})\b(?!\s*[a-z])/i.exec(text);
  if (header) return ok(now + Number(header[1]) * 1000);
  const span = /(?:try again|retry|resets?|available(?: again)?|ready)\s+(?:in|after)\s+~?\s*((?:\d+(?:\.\d+)?\s*(?:days?|d|hours?|hrs?|hr|h|minutes?|mins?|min|m|seconds?|secs?|sec|s)\b[\s,]*(?:and\s+)?)+)/i.exec(text);
  if (span) {
    let ms = 0;
    for (const [, n, unit] of span[1].matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)/gi)) ms += Number(n) * (UNIT[unit.toLowerCase()] || 0);
    return ms ? ok(now + ms) : null;
  }
  const clock = /(?:try again at|resets?(?: at)?|available at)\s+(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?(?![\d:])/i.exec(text);
  if (clock && (clock[2] || clock[3])) {
    let hour = Number(clock[1]) % 12 + (clock[3] && /^p/i.test(clock[3]) ? 12 : 0);
    if (!clock[3]) hour = Number(clock[1]);
    if (hour > 23 || Number(clock[2] || 0) > 59) return null;
    const at = new Date(now);
    at.setHours(hour, Number(clock[2] || 0), 0, 0);
    if (at.getTime() <= now) at.setDate(at.getDate() + 1);
    return ok(at.getTime());
  }
  return null;
}

// 失败卡上的那几个字：一个半小时以内说「约 N 分钟后」，否则「今天 / 明天 / M 月 D 日 HH:MM」。
export function resetText(resetAt, now = Date.now()) {
  const at = Date.parse(resetAt || '');
  if (!Number.isFinite(at) || at <= now) return '';
  const minutes = Math.ceil((at - now) / 60_000);
  if (minutes <= 90) return `约 ${minutes} 分钟后`;
  const d = new Date(at), today = new Date(now), pad = n => String(n).padStart(2, '0');
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return `今天 ${clock}`;
  if (d.toDateString() === tomorrow.toDateString()) return `明天 ${clock}`;
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${clock}`;
}

/** account：账号 / 额度用不了（等也不会好）；key：密钥不对；missing：没有这个模型；
 *  busy：真忙（429 / 过载，稍等会好）；timeout / network / down：其他上游问题。 */
export function classifyModelFailure(reason = '') {
  const text = String(reason || '');
  if (!text.trim()) return 'other';
  for (const [kind, pattern] of [['account', ACCOUNT], ['key', KEY], ['missing', MISSING], ['busy', BUSY],
    ['timeout', TIMEOUT], ['network', NETWORK], ['down', DOWN]]) if (pattern.test(text)) return kind;
  return 'other';
}

// 等也不会好的那几类：界面直接说「这个模型现在用不了」并给换模型的出路。
export const UNUSABLE_KINDS = new Set(['account', 'key', 'missing']);

/** 这一轮有没有失败。OpenClaw 在「还没回出内容就失败」时 agent_end 仍给 success: true，
 *  model_call_ended 也报 completed；真正的信号是最后一条助手消息 stopReason === 'error'。 */
export function turnFailed(event = {}) {
  const messages = Array.isArray(event?.messages) ? event.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const entry = messages[i];
    const message = entry?.message && typeof entry.message === 'object' ? entry.message : entry;
    if (message?.role !== 'assistant') continue;
    return message.stopReason === 'error';
  }
  return event?.success !== true;
}

const ref = (provider, model) => (provider && model ? `${provider}/${model}` : '');
const modelOf = (value) => (typeof value === 'string' ? value : value && typeof value === 'object' ? value.primary : '') || '';

/** 某个模式配置里的模型顺序：自己的主模型和后备，再是全局默认。 */
export function configuredModels(config = {}, agentId = '') {
  const agents = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  const agent = agents.find((item) => item?.id === agentId) || {};
  const defaults = config?.agents?.defaults?.model;
  const out = [];
  for (const value of [agent.model, defaults]) {
    if (!value) continue;
    out.push(modelOf(value));
    if (Array.isArray(value?.fallbacks)) out.push(...value.fallbacks);
  }
  // 别的模式在用的后备也是「配好的、能用的」候选（例如无限模式的 gemini-3-flash）。
  for (const item of agents) if (Array.isArray(item?.model?.fallbacks)) out.push(...item.model.fallbacks);
  return [...new Set(out.filter((value) => typeof value === 'string' && value.includes('/')))];
}

export class ModelHealth {
  constructor({now = () => Date.now(), limit = 512} = {}) {
    this.now = now;
    this.limit = limit;
    this.runs = new Map();      // runId → 这一轮最后调用的模型
    this.models = new Map();    // provider/model → {okAt, failAt, reason}
    this.sessions = new Map();  // sessionKey → {model, reason, kind, at}
  }

  trim(map) { while (map.size > this.limit) map.delete(map.keys().next().value); }

  callStarted(event = {}) {
    const model = ref(event.provider, event.model);
    if (!model || !event.runId) return;
    this.runs.set(String(event.runId), model);
    this.trim(this.runs);
  }

  callEnded(event = {}) {
    const model = ref(event.provider, event.model) || this.runs.get(String(event.runId || '')) || '';
    if (!model) return;
    const record = {...(this.models.get(model) || {})};
    if (event.outcome === 'completed') record.okAt = this.now();
    else if (event.outcome === 'error') {
      record.failAt = this.now();
      record.reason = String(event.errorMessage || event.error || event.errorCategory || event.failureKind || record.reason || '').slice(0, 300);
    } else return;
    this.models.delete(model);
    this.models.set(model, record);
    this.trim(this.models);
  }

  /** 一轮结束：失败就记下原因；成功就清掉这个会话的旧失败。 */
  turnEnded(sessionKey = '', {runId = '', success = false, reason = '', model = ''} = {}) {
    if (!sessionKey) return;
    if (success) { this.sessions.delete(sessionKey); return; }
    const used = model || this.runs.get(String(runId || '')) || '';
    const text = String(reason || '').slice(0, 300);
    const resetAt = resetTime(String(reason || '').slice(0, 4000), this.now());
    if (used) {
      // 上游失败时 model_call_ended 也可能报 completed：以这一轮的结果为准，别再把它推荐出去。
      const record = {...(this.models.get(used) || {}), failAt: this.now(), reason: text || this.models.get(used)?.reason || ''};
      this.models.delete(used);
      this.models.set(used, record);
      this.trim(this.models);
    }
    this.sessions.delete(sessionKey);
    this.sessions.set(sessionKey, {model: used, reason: text, kind: classifyModelFailure(text), at: this.now(), resetAt});
    this.trim(this.sessions);
  }

  /** 挑一个现在大概率能用的模型：最近成功过、之后没再失败的优先；其次是配置里没失败过的。 */
  suggest(failedModel = '', candidates = []) {
    const usable = (model) => {
      const record = this.models.get(model);
      return record && record.okAt && (!record.failAt || record.okAt > record.failAt);
    };
    const failedRecently = (model) => {
      const record = this.models.get(model);
      return record?.failAt && (!record.okAt || record.failAt > record.okAt);
    };
    const recentOk = [...this.models.keys()].reverse().filter(usable);
    const pool = [...new Set([...candidates.filter(usable), ...recentOk, ...candidates])];
    return pool.find((model) => model && model !== failedModel && !failedRecently(model)) || '';
  }

  failure(sessionKey = '', {candidates = []} = {}) {
    const record = this.sessions.get(sessionKey);
    if (!record) return {failure: null, suggestion: ''};
    // 恢复时间已经过了就不再写；「几点」按取的那一刻算（今天 / 明天不会过期）。
    const resetLabel = resetText(record.resetAt, this.now());
    return {failure: {...record, resetAt: resetLabel ? record.resetAt : null, resetText: resetLabel, unusable: UNUSABLE_KINDS.has(record.kind) && !resetLabel},
      suggestion: this.suggest(record.model, candidates)};
  }
}
