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
const MISSING = /(?:model[_ ]?not[_ ]?found|unknown model|unsupported model|no such model|model .{0,40}does not exist)/i;
const BUSY = /(?:\b429\b|rate.?limit|too many requests|overloaded|\b529\b|server is busy)/i;
const TIMEOUT = /(?:timed? ?out|timeout|ETIMEDOUT|deadline exceeded)/i;
const NETWORK = /(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|network ?error|connection (?:reset|refused|closed))/i;
const DOWN = /(?:\b50[0234]\b|service unavailable|bad gateway|internal (?:server )?error|upstream)/i;

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
    this.sessions.delete(sessionKey);
    this.sessions.set(sessionKey, {model: used, reason: text, kind: classifyModelFailure(text), at: this.now()});
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
    return {failure: {...record, unusable: UNUSABLE_KINDS.has(record.kind)}, suggestion: this.suggest(record.model, candidates)};
  }
}
