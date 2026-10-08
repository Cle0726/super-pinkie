const POLL_MS = 5 * 60_000;
const MIN_REQUEST_GAP_MS = 30_000;
const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9_.:-]*)*$/;
const MEDIA_ID = /(?:^|[-_/])(?:image|imagine|video|veo|audio|tts|speech|embedding|embed|rerank|transcribe)(?:[-_.]|$)/i;
const EFFORT_SUFFIX = /-(?:extra-low|non-reasoning|reasoning|thinking|tiered|adaptive|xhigh|high|medium|low)$/i;
const VERIFIED_GPT6 = /^gpt-6-(?:astra|sol|luna)$/;
const GPT6_EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh']);
// These WorkBuddy models advertise reasoning in the official model catalog.
// High was verified through this local OpenAI-compatible route. Do not invent
// additional effort levels from a model name alone.
const WORKBUDDY_REASONING_IDS = new Set([
  'deepseek-v4-pro', 'deepseek-v4.1-flash', 'glm-5.1', 'glm-5.2', 'glm-5.3',
  'glm-5.3-flash', 'glm-5v-turbo', 'hy3', 'hy3-x', 'hy4-preview',
  'kimi-k2.6', 'kimi-k2.7', 'kimi-k2.8-preview', 'kimi-k3-1', 'minimax-m3',
].map((id) => `workbuddy/${id}`));
const workBuddyThinkingCompat = () => ({supportsReasoningEffort: true, supportedReasoningEfforts: ['high']});
function isAutoDiscoveredWorkBuddy(entry) {
  return WORKBUDDY_REASONING_IDS.has(entry?.id) && entry.name === modelName(entry.id)
    && entry.reasoning === false && !entry.compat && Array.isArray(entry.input)
    && entry.input.length === 1 && entry.input[0] === 'text';
}


function modelName(id) {
  const parts = id.split('/');
  const model = parts.pop();
  const words = {gpt: 'GPT', glm: 'GLM', deepseek: 'DeepSeek', minimax: 'MiniMax',
    kimi: 'Kimi', qwen: 'Qwen', zai: 'Z.AI', workbuddy: 'WorkBuddy'};
  const label = model.split(/[-_]/).map((part) => words[part.toLowerCase()]
    || (/^hy\d/i.test(part) ? part.toUpperCase()
      : part ? part[0].toUpperCase() + part.slice(1) : part)).join(' ').replace(/^GPT (?=\d)/, 'GPT-');
  const route = parts.map((part) => words[part.toLowerCase()] || part).join('/');
  if (route === 'WorkBuddy') return /^deepseek[-_]/i.test(model) ? `${label} · WB` : label;
  return route ? `${label} · ${route}` : label;
}

function isAutoDiscoveredGpt6(entry) {
  return entry && VERIFIED_GPT6.test(entry.id) && entry.name === modelName(entry.id)
    && entry.reasoning === false && entry.contextWindow === 128000
    && entry.contextTokens === 128000 && !entry.compat
    && Array.isArray(entry.input) && entry.input.length === 1 && entry.input[0] === 'text';
}

function isLegacyAutoDiscoveredGpt6(entry) {
  return entry && VERIFIED_GPT6.test(entry.id)
    && isAutoDiscoveredGpt6({...entry, name: modelName(entry.id)})
    && entry.name === modelName(entry.id).replace(/^GPT-/, 'GPT ');
}

function isVerifiedTextOnlyGpt6(entry) {
  return entry && VERIFIED_GPT6.test(entry.id) && entry.name === modelName(entry.id)
    && entry.reasoning === true && entry.contextWindow === 128000
    && entry.contextTokens === 128000 && Array.isArray(entry.input)
    && entry.input.length === 1 && entry.input[0] === 'text'
    && JSON.stringify(entry.compat?.supportedReasoningEfforts) === JSON.stringify(GPT6_EFFORTS);
}

export function chatModelIds(payload) {
  if (!Array.isArray(payload?.data) || payload.data.length > 500) throw new Error('上游模型列表格式不正确');
  return [...new Set(payload.data.map((entry) => entry?.id)
    .filter((id) => typeof id === 'string' && id.length <= 128 && MODEL_ID.test(id) && !MEDIA_ID.test(id)))];
}

// Read total-window metadata only. Output limits and input limits are separate
// budgets, and an ID advertised without a window must keep its local settings.
export function upstreamContextWindows(payload) {
  const ids = new Set(chatModelIds(payload));
  const windows = new Map();
  for (const entry of payload.data) {
    if (!ids.has(entry?.id)) continue;
    const values = ['context_window', 'context_length', 'contextWindow', 'contextLength']
      .map((key) => entry[key]).filter((value) => typeof value === 'number'
        && Number.isSafeInteger(value) && value > 0 && value <= 100_000_000);
    if (!values.length) continue;
    // Conflicting aliases or duplicate rows never inflate the declared window.
    const window = Math.min(...values, windows.get(entry.id) ?? Infinity);
    windows.set(entry.id, window);
  }
  return windows;
}

export function newModelEntries(current, ids, {verifiedGpt6 = false, verifiedWorkBuddy = false, contextWindows = new Map()} = {}) {
  const known = new Set(current.map((entry) => entry.id));
  return ids.filter((id) => !known.has(id)).map((id) => {
    const base = id.replace(EFFORT_SUFFIX, '');
    const sibling = current.find((entry) => entry.id === base)
      || current.find((entry) => entry.id !== id && entry.id.replace(EFFORT_SUFFIX, '') === base);
    const context = contextWindows.get(id);
    const contextFields = context ? {contextWindow: context, contextTokens: context} : {};
    if (sibling) return {...structuredClone(sibling), id, name: modelName(id), ...contextFields};
    // IDs alone do not prove modality or reasoning parameter support.
    const reasoning = /-(?:reasoning|thinking|tiered|adaptive|xhigh|high|medium|low)$/.test(id);
    const verified = verifiedGpt6 && VERIFIED_GPT6.test(id);
    const workBuddy = verifiedWorkBuddy && WORKBUDDY_REASONING_IDS.has(id);
    return {
      id, name: modelName(id), reasoning: verified || workBuddy || reasoning,
      input: verified ? ['text', 'image'] : ['text'], contextWindow: 128000, contextTokens: 128000, ...contextFields,
      ...(verified ? {compat: {supportedReasoningEfforts: [...GPT6_EFFORTS]}} : workBuddy ? {compat: workBuddyThinkingCompat()} : {}),
    };
  });
}

async function readLimitedJson(response) {
  if (!response.ok) throw new Error(`上游模型列表请求失败 (${response.status})`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('上游模型列表为空');
  let size = 0;
  const chunks = [];
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2_000_000) {
      await reader.cancel();
      throw new Error('上游模型列表过大');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function createModelSynchronizer(api, {fetchImpl = fetch, now = Date.now} = {}) {
  let pending;
  let lastChecked = 0;
  let lastResult = {added: 0, available: 0, checkedAt: 0};

  async function run() {
    const providers = api.runtime.config.current()?.models?.providers || {};
    const configured = Object.entries(providers).filter(([, provider]) =>
      provider?.baseUrl && typeof provider.apiKey === 'string' && provider.apiKey.trim());
    if (!configured.length) {
      throw new Error('模型上游地址或密钥未配置');
    }
    const results = await Promise.allSettled(configured.map(async ([name, provider]) => {
      const base = new URL(provider.baseUrl.endsWith('/') ? provider.baseUrl : `${provider.baseUrl}/`);
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
          (base.protocol === 'http:' && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(base.hostname))) {
        throw new Error(`${name} 模型上游地址不安全`);
      }
      const response = await fetchImpl(new URL('models', base), {
        headers: {...provider.headers, Authorization: `Bearer ${provider.apiKey}`},
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      const payload = await readLimitedJson(response);
      const ids = chatModelIds(payload);
      const contextWindows = upstreamContextWindows(payload);
      const contextUpdates = (provider.models || []).flatMap((entry) => {
        const window = contextWindows.get(entry.id);
        return window && (entry.contextWindow !== window || entry.contextTokens !== window)
          ? [{id: entry.id, window, beforeWindow: entry.contextWindow, beforeTokens: entry.contextTokens}] : [];
      });
      // This account's clekk GPT-6 endpoints were verified with reasoning_effort.
      // A different provider advertising the same ID is not proof its key can invoke it.
      const verifiedGpt6 = name === 'clekk';
      const verifiedWorkBuddy = name === 'mm';
      const workBuddyPending = verifiedWorkBuddy ? (provider.models || [])
        .filter((entry) => ids.includes(entry.id) && isAutoDiscoveredWorkBuddy(entry)) : [];
      const legacy = verifiedGpt6 ? (provider.models || [])
        .filter((entry) => ids.includes(entry.id) && isLegacyAutoDiscoveredGpt6(entry)) : [];
      // Official GPT-6 modality specs include image input. The local proxy's
      // image forwarding is intentionally not claimed as tested here.
      const imagePending = verifiedGpt6 ? (provider.models || [])
        .filter((entry) => ids.includes(entry.id) && isVerifiedTextOnlyGpt6(entry)) : [];
      return {name, available: ids.length,
        additions: newModelEntries(provider.models || [], ids, {verifiedGpt6, verifiedWorkBuddy, contextWindows}), legacy, imagePending, workBuddyPending, contextUpdates, contextUpdated: 0};
    }));
    const successes = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
    if (!successes.length) throw results[0].reason;
    const changes = successes.filter((result) => result.additions.length || result.legacy.length || result.imagePending.length || result.workBuddyPending.length || result.contextUpdates.length);
    if (changes.length) {
      await api.runtime.config.mutateConfigFile({
        base: 'source', afterWrite: {mode: 'auto'},
        mutate(draft) {
          for (const result of changes) {
            const {name, additions: entries, legacy, imagePending, workBuddyPending, contextUpdates} = result;
            const models = draft.models?.providers?.[name]?.models;
            if (!Array.isArray(models)) throw new Error(`${name} 模型配置已改变，稍后重试`);
            const live = new Set(models.map((model) => model.id));
            for (const entry of entries) if (!live.has(entry.id)) { models.push(entry); live.add(entry.id); }
            for (const old of legacy) {
              const entry = models.find((model) => model.id === old.id);
              if (!isLegacyAutoDiscoveredGpt6(entry)) continue;
              entry.name = modelName(entry.id);
              entry.reasoning = true;
              entry.input = ['text', 'image'];
              entry.compat = {supportedReasoningEfforts: [...GPT6_EFFORTS]};
            }
            for (const old of imagePending) {
              const entry = models.find((model) => model.id === old.id);
              if (isVerifiedTextOnlyGpt6(entry)) entry.input = ['text', 'image'];
            }
            for (const old of workBuddyPending) {
              const entry = models.find((model) => model.id === old.id);
              if (!isAutoDiscoveredWorkBuddy(entry)) continue;
              entry.reasoning = true;
              entry.compat = workBuddyThinkingCompat();
            }
            result.contextUpdated = 0;
            for (const update of contextUpdates) {
              const entry = models.find((model) => model.id === update.id);
              // A concurrent configuration edit wins; the next poll can reconcile it.
              if (!entry || entry.contextWindow !== update.beforeWindow || entry.contextTokens !== update.beforeTokens) continue;
              entry.contextWindow = update.window;
              entry.contextTokens = update.window;
              result.contextUpdated++;
            }
          }
        },
      });
    }
    lastChecked = now();
    lastResult = {
      added: successes.reduce((sum, result) => sum + result.additions.length, 0),
      upgraded: successes.reduce((sum, result) => sum + result.legacy.length + result.imagePending.length + result.workBuddyPending.length, 0),
      contextUpdated: successes.reduce((sum, result) => sum + result.contextUpdated, 0),
      available: successes.reduce((sum, result) => sum + result.available, 0),
      checkedAt: lastChecked,
      providers: Object.fromEntries(successes.map(({name, available, additions, legacy, imagePending, workBuddyPending, contextUpdated}) =>
        [name, {available, added: additions.length, upgraded: legacy.length + imagePending.length + workBuddyPending.length, contextUpdated}])),
      failed: results.filter((result) => result.status === 'rejected').length,
    };
    return lastResult;
  }

  return {
    sync({force = false} = {}) {
      if (pending) return pending;
      if (!force && lastChecked && now() - lastChecked < MIN_REQUEST_GAP_MS) return Promise.resolve(lastResult);
      pending = run().finally(() => { pending = undefined; });
      return pending;
    },
  };
}

export function registerModelSync(api) {
  const synchronizer = createModelSynchronizer(api);
  let timer;
  let stopped = false;
  api.registerService?.({
    id: 'pinkie-model-sync',
    start(ctx) {
      stopped = false;
      const poll = () => {
        if (stopped) return;
        void synchronizer.sync().catch((error) => ctx.logger.warn(`模型同步暂时失败：${error.message}`));
      };
      poll();
      timer = setInterval(poll, POLL_MS);
      timer.unref?.();
    },
    stop() { stopped = true; if (timer) clearInterval(timer); timer = undefined; },
  });
  api.registerGatewayMethod('pinkie.models.sync', async ({respond}) => {
    try { respond(true, await synchronizer.sync()); }
    catch (error) { respond(false, undefined, {code: 'UNAVAILABLE', message: error.message}); }
  }, {scope: 'operator.admin'});
}
