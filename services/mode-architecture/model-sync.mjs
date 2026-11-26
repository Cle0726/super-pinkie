import fs from 'node:fs';
import path from 'node:path';
import {withVisionInput} from './model-setup.mjs';

const POLL_MS = 5 * 60_000;
const MIN_REQUEST_GAP_MS = 30_000;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9_.:-]*)*$/;
const MEDIA_ID = /(?:^|[-_/])(?:image|imagine|video|veo|audio|tts|speech|embedding|embed|rerank|transcribe)(?:[-_.]|$)/i;
// Keep the default's scope consistent with the startup migration in setup.py.
const NON_CHAT_VISION_ID = /imagine|image|video|veo-|embed|tts|whisper|speech|audio|transcri|rerank|moderation|search/i;
// 从 ID 认出它是哪个模型（和 ui/injections/laolao-model-picker.js 的 idBrand 同一套规则，测试守着两边一致）。
// 认不出名字的上游模型（比如 auto、copilot-search-a、memory4-dream）不自动加进模型列表：11-16 用户「当找不到模型名时就不要显示出来了」。
const KNOWN_MODEL = /^(?:(?:gemini|gemma|veo|claude|codex|gpt|o1|o3|o4|grok|groq|deepseek|mistral|kimi|moonshot|glm|zai|llama|ollama|minimax|doubao|perplexity|hunyuan|space-bunny|tab)|(?:qwen|qwq)\d*|hy\d+[a-z]*)(?:[-_.:]|$)|^(?:mimo|step)[-_.]/i;
export function recognizedModelId(id) {
  return KNOWN_MODEL.test(String(id || '').split('/').at(-1));
}
const EFFORT_SUFFIX = /-(?:extra-low|non-reasoning|reasoning|thinking|tiered|adaptive|xhigh|high|medium|low)$/i;
const VERIFIED_GPT6 = /^(?:gpt-6-(?:astra|sol|luna)|gpt-6\.1-sol)$/;
const GPT6_EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
const CLEKK_NATIVE_EFFORTS=new Map([
  ...['gpt-5.4','gpt-5.4-mini','gpt-5.5'].map(id=>[id,['none','low','medium','high','xhigh']]),
  ...['gpt-6-astra','gpt-6.1-sol'].map(id=>[id,[...GPT6_EFFORTS]]),
  ...['gpt-6-sol','gpt-6-luna','gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna'].map(id=>[id,['none',...GPT6_EFFORTS]]),
]);
// WorkBuddy's OpenAI-compatible route streams reasoning_content. Opt new
// catalog entries in by default instead of maintaining a model-ID allowlist.
// Existing user-customized entries are never rewritten by this migration.
const workBuddyThinkingCompat = () => ({supportsReasoningEffort: true, supportedReasoningEfforts: ['high']});
// The loopback vision default (setup.py and discovery) turns ['text'] into ['text','image'];
// such an entry is still untouched, so it must still recover reasoning (11-21: 63 stuck off).
function isAutoDiscoveredPlaceholder(entry) {
  return entry?.name === modelName(entry.id)
    && entry.reasoning === false && !entry.compat && Array.isArray(entry.input)
    && entry.input[0] === 'text' && (entry.input.length === 1 || entry.input.length === 2 && entry.input[1] === 'image');
}
function isAutoDiscoveredWorkBuddy(entry) {
  return entry?.id?.startsWith('workbuddy/') && isAutoDiscoveredPlaceholder(entry);
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

// Explicit upstream capabilities are authoritative; missing fields stay unknown.
export function upstreamReasoningCapabilities(payload) {
  const ids = new Set(chatModelIds(payload)), result = new Map();
  const allowed = new Set(['none', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max', 'ultra']);
  for (const entry of payload.data) {
    if (!ids.has(entry.id)) continue;
    const raw = entry.supported_reasoning_efforts ?? entry.reasoning_efforts
      ?? entry.compat?.supportedReasoningEfforts ?? entry.capabilities?.reasoning?.efforts;
    if (!Array.isArray(raw) || !raw.length || raw.length > 10
      || raw.some(level => typeof level !== 'string' || !allowed.has(level.toLowerCase()))) continue;
    result.set(entry.id, [...new Set(raw.map(level => level.toLowerCase()))]);
  }
  return result;
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
    && [JSON.stringify(GPT6_EFFORTS),JSON.stringify(GPT6_EFFORTS.slice(0,-1))].includes(JSON.stringify(entry.compat?.supportedReasoningEfforts));
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
  return ids.filter((id) => !known.has(id) && recognizedModelId(id)).map((id) => {
    const base = id.replace(EFFORT_SUFFIX, '');
    const sibling = current.find((entry) => entry.id === base)
      || current.find((entry) => entry.id !== id && entry.id.replace(EFFORT_SUFFIX, '') === base);
    const context = contextWindows.get(id);
    const contextFields = context ? {contextWindow: context, contextTokens: context} : {};
    if (sibling) return {...structuredClone(sibling), id, name: modelName(id), reasoning: true, ...contextFields};
    // Reasoning is a transport capability: always pass it through. Providers
    // that do not return reasoning simply produce no thinking block; guessing
    // "false" from an unfamiliar ID would hide real reasoning_content.
    const verified = verifiedGpt6 && VERIFIED_GPT6.test(id);
    const workBuddy = verifiedWorkBuddy && id.startsWith('workbuddy/');
    return {
      id, name: modelName(id), reasoning: true,
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

function capabilityOverrides(api) {
  try {
    const dir = api?.runtime?.state?.resolveStateDir?.();
    if (!dir) return {};
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'pinkie-model-setup.json'), 'utf8'));
    const caps = raw?.capabilities;
    return caps && typeof caps === 'object' ? caps : {};
  } catch { return {}; }
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
    const capOverrides = capabilityOverrides(api);
    const hasCustomContext = (providerName, modelId) => typeof capOverrides[`${providerName}/${modelId}`]?.contextWindow === 'number';
    const disabledVision = (providerName, modelId) => capOverrides[`${providerName}/${modelId}`]?.vision === false;
    const disabledReasoning = (providerName, modelId) => capOverrides[`${providerName}/${modelId}`]?.reasoning === false;
    const results = await Promise.allSettled(configured.map(async ([name, provider]) => {
      const base = new URL(provider.baseUrl.endsWith('/') ? provider.baseUrl : `${provider.baseUrl}/`);
      const loopback = LOOPBACK_HOSTS.has(base.hostname);
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
          (base.protocol === 'http:' && !loopback)) {
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
      const declaredEfforts = upstreamReasoningCapabilities(payload);
      const reasoningPending = (provider.models || []).flatMap(entry => {
        if (entry.compat || !ids.includes(entry.id) || disabledReasoning(name, entry.id)) return [];
        const generated=[modelName(entry.id),modelName(entry.id).replace(/^GPT-/, 'GPT ')].includes(entry.name);
        const efforts = declaredEfforts.get(entry.id)
          || (name === 'clekk' && (generated || entry.reasoning===true) ? CLEKK_NATIVE_EFFORTS.get(entry.id) : null);
        return efforts ? [{id: entry.id, before: JSON.stringify(entry), efforts}] : [];
      });
      const contextUpdates = (provider.models || []).flatMap((entry) => {
        const window = contextWindows.get(entry.id);
        // 自定义窗口只能往小调：比上游真实窗口还大时，请求会超出上游单帧上限，压缩后仍反复越线。
        const custom = hasCustomContext(name, entry.id) ? capOverrides[`${name}/${entry.id}`].contextWindow : undefined;
        if (custom !== undefined && !(window && window < custom)) return [];
        return window && (entry.contextWindow !== window || entry.contextTokens !== window)
          ? [{id: entry.id, window, beforeWindow: entry.contextWindow, beforeTokens: entry.contextTokens, customWindow: custom}] : [];
      });
      // This account's clekk GPT-6 endpoints were verified with reasoning_effort.
      // A different provider advertising the same ID is not proof its key can invoke it.
      const verifiedGpt6 = name === 'clekk';
      const verifiedWorkBuddy = name === 'mm';
      const workBuddyPending = verifiedWorkBuddy ? (provider.models || [])
        .filter((entry) => ids.includes(entry.id) && isAutoDiscoveredWorkBuddy(entry) && !disabledReasoning(name, entry.id)) : [];
      const autoThinkingPending = (provider.models || []).filter((entry) =>
        ids.includes(entry.id) && isAutoDiscoveredPlaceholder(entry) && !disabledReasoning(name, entry.id)
        && !workBuddyPending.includes(entry)
        && !reasoningPending.some((change) => change.id === entry.id));
      const legacy = verifiedGpt6 ? (provider.models || [])
        .filter((entry) => ids.includes(entry.id) && isLegacyAutoDiscoveredGpt6(entry) && !disabledVision(name, entry.id) && !disabledReasoning(name, entry.id)) : [];
      // Official GPT-6 modality specs include image input. The local proxy's
      // image forwarding is intentionally not claimed as tested here.
      const imagePending = verifiedGpt6 ? (provider.models || [])
        .filter((entry) => ids.includes(entry.id) && isVerifiedTextOnlyGpt6(entry) && !disabledVision(name, entry.id)) : [];
      const known = new Set((provider.models || []).map((entry) => entry.id));
      const additions = newModelEntries(provider.models || [], ids, {verifiedGpt6, verifiedWorkBuddy, contextWindows}).map(entry => {
        const vision = capOverrides[`${name}/${entry.id}`]?.vision;
        // Discovery runs after setup.py, so new loopback models need the same
        // default immediately. A saved toggle wins, even over a sibling clone.
        if (typeof vision === 'boolean') entry.input = withVisionInput(entry.input, vision);
        else if (loopback && !NON_CHAT_VISION_ID.test(entry.id)) entry.input = withVisionInput(entry.input, true);
        const efforts = declaredEfforts.get(entry.id);
        return efforts ? {...entry, reasoning: true, compat: {...entry.compat, supportsReasoningEffort: true, supportedReasoningEfforts: efforts}} : entry;
      });
      return {name, available: ids.length, unnamed: ids.filter((id) => !known.has(id) && !recognizedModelId(id)).length,
        additions,
        legacy, imagePending, workBuddyPending, autoThinkingPending, reasoningPending, contextUpdates, contextUpdated: 0, contextCapped: []};
    }));
    const successes = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
    if (!successes.length) throw results[0].reason;
    const changes = successes.filter((result) => result.additions.length || result.legacy.length || result.imagePending.length || result.workBuddyPending.length || result.autoThinkingPending.length || result.reasoningPending.length || result.contextUpdates.length);
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
            for (const old of result.autoThinkingPending) {
              const entry = models.find((model) => model.id === old.id);
              if (isAutoDiscoveredPlaceholder(entry)) entry.reasoning = true;
            }
            for (const change of result.reasoningPending) {
              const entry = models.find(model => model.id === change.id);
              if (!entry || JSON.stringify(entry) !== change.before) continue;
              entry.reasoning = true;
              entry.compat = {supportsReasoningEffort: true, supportedReasoningEfforts: change.efforts};
            }
            result.contextUpdated = 0;
            result.contextCapped = [];
            for (const update of contextUpdates) {
              const entry = models.find((model) => model.id === update.id);
              // A concurrent configuration edit wins; the next poll can reconcile it.
              if (!entry || entry.contextWindow !== update.beforeWindow || entry.contextTokens !== update.beforeTokens) continue;
              entry.contextWindow = update.window;
              entry.contextTokens = update.window;
              result.contextUpdated++;
              if (update.customWindow !== undefined) {
                const notice = `${name}/${update.id} 自定义上下文窗口 ${update.customWindow} 超过上游声明的 ${update.window}，已按上游取 ${update.window}`;
                result.contextCapped.push(notice);
                api.logger?.warn?.(`[model-sync] ${notice}`);
              }
            }
          }
        },
      });
    }
    lastChecked = now();
    lastResult = {
      added: successes.reduce((sum, result) => sum + result.additions.length, 0),
      upgraded: successes.reduce((sum, result) => sum + new Set([...result.legacy,...result.imagePending,...result.workBuddyPending,...result.autoThinkingPending,...result.reasoningPending].map(row=>row.id)).size, 0),
      contextUpdated: successes.reduce((sum, result) => sum + result.contextUpdated, 0),
      contextCapped: successes.flatMap((result) => result.contextCapped),
      available: successes.reduce((sum, result) => sum + result.available, 0),
      checkedAt: lastChecked,
      providers: Object.fromEntries(successes.map(({name, available, additions, legacy, imagePending, workBuddyPending, autoThinkingPending, reasoningPending, contextUpdated}) =>
        [name, {available, added: additions.length, upgraded: new Set([...legacy,...imagePending,...workBuddyPending,...autoThinkingPending,...reasoningPending].map(row=>row.id)).size, contextUpdated}])),
      unnamed: successes.reduce((sum, result) => sum + result.unnamed, 0),
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
