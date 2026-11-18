// 小白配模型（设定防护 B 部分）：设置里的「模型服务」页用的网关方法。
//
//   pinkie.modelSetup.presets            常见服务商预设（地址、接口类型、推荐模型、拿密钥的官方链接和步骤）
//   pinkie.modelSetup.list               已配好的服务商（密钥只给末四位）、默认模型、要不要引导首次配置
//   pinkie.modelSetup.test               用填的密钥实际请求一次：列模型；给了 model 就再发一句极短对话
//   pinkie.modelSetup.save               新增 / 编辑一个服务商（编辑时不填密钥 = 沿用原来的）
//   pinkie.modelSetup.setCapability      打开 / 关闭某个已有模型的「能看图片」（写 models.providers.<p>.models[].input）
//   pinkie.modelSetup.setDefault         设默认模型（可选四个模式一起换）
//   pinkie.modelSetup.disable / enable   停用（挪出 openclaw.json，放进只有本机能读的旁存文件）/ 重新启用
//   pinkie.modelSetup.remove             删除（只删这个页面加的服务商；作者自己的 mm/litellm/clekk… 不让在这里删）
//
// 写配置走插件自己的受控写入（runtime.config.mutateConfigFile），不是聊天工具，所以不受设定防护 A3 拦；
// 聊天里的碧琪也调不到这些方法（它们只在设置界面里通过网关 RPC 调用），只通过 pinkie_model_capability 窄工具调 setCapability。
// 密钥：只存在 openclaw.json 的 models.providers.<id>.apiKey（现有的凭据位置）；返回给界面的只有末四位；
// 不写日志、不进模型上下文；出错信息里出现密钥会被抹掉。
import fs from 'node:fs';
import path from 'node:path';

// 预设逐个对照官方文档核实（2026-11-13），来源写在 briefs/settings-guard/PROGRESS.md。
export const PRESETS = Object.freeze([
  {id: 'deepseek', label: 'DeepSeek 深度求索', region: 'cn', baseUrl: 'https://api.deepseek.com', api: 'openai-completions',
    models: ['deepseek-flash', 'deepseek-v4-pro'], keyUrl: 'https://platform.deepseek.com/api_keys',
    steps: ['打开 DeepSeek 开放平台，用手机号登录', '先在「充值」里充一点余额', '在「API keys」点「创建 API key」，复制下来粘贴到这里']},
  {id: 'bailian', label: '阿里云百炼 · 通义千问', region: 'cn', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', api: 'openai-completions',
    models: ['qwen-plus', 'qwen-max', 'qwen3.8-max'], keyUrl: 'https://bailian.console.aliyun.com/model/settings/api-key',
    steps: ['用阿里云账号登录百炼控制台，开通「模型服务」', '在「API Key」页创建一个 Key（选北京地域）', '复制粘贴到这里']},
  {id: 'kimi', label: '月之暗面 Kimi', region: 'cn', baseUrl: 'https://api.moonshot.cn/v1', api: 'openai-completions',
    models: ['kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed'], keyUrl: 'https://platform.kimi.com/console/api-keys',
    steps: ['登录 Kimi 开放平台', '在「API Key 管理」新建一个 Key', '复制粘贴到这里（新账号一般有少量体验额度）']},
  {id: 'zhipu', label: '智谱 GLM', region: 'cn', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', api: 'openai-completions',
    models: ['glm-5.3', 'glm-5.2', 'glm-5.3-flash'], keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    steps: ['注册并登录智谱开放平台 bigmodel.cn', '在「API Keys」添加新的 Key', '复制粘贴到这里']},
  {id: 'ark', label: '火山方舟 · 豆包', region: 'cn', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', api: 'openai-completions',
    models: ['doubao-seed-2-1-pro-260915'], keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    steps: ['登录火山引擎，进入「火山方舟」控制台', '在「开通管理」里开通要用的豆包模型', '在「API Key 管理」创建 Key，复制粘贴到这里']},
  {id: 'siliconflow', label: '硅基流动', region: 'cn', baseUrl: 'https://api.siliconflow.cn/v1', api: 'openai-completions',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen3-32B'], keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    steps: ['注册并登录硅基流动', '在「API 密钥」点「新建 API 密钥」', '复制粘贴到这里']},
  {id: 'openrouter', label: 'OpenRouter', region: 'intl', baseUrl: 'https://openrouter.ai/api/v1', api: 'openai-completions',
    models: ['openai/gpt-6-luna', 'google/gemini-4-hydrogen'], keyUrl: 'https://openrouter.ai/settings/keys', keyCheck: '/key',
    steps: ['登录 OpenRouter（国外服务，可能需要代理）', '在「Credits」充值，再到「Keys」创建一个 Key', '复制粘贴到这里']},
  {id: 'openai', label: 'OpenAI', region: 'intl', baseUrl: 'https://api.openai.com/v1', api: 'openai-completions',
    models: ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'], keyUrl: 'https://platform.openai.com/api-keys',
    steps: ['登录 OpenAI 开发者平台（国外服务，需要代理）', '在 Billing 里绑卡充值', '在「API keys」创建 Key，复制粘贴到这里']},
  {id: 'gemini', label: 'Google Gemini', region: 'intl', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', api: 'openai-completions',
    models: ['gemini-4-hydrogen'], keyUrl: 'https://aistudio.google.com/apikey',
    steps: ['用 Google 账号登录 AI Studio（国外服务，需要代理）', '点「Create API key」', '复制粘贴到这里']},
  {id: 'custom', label: '其他（兼容 OpenAI 的接口）', region: 'any', baseUrl: '', api: 'openai-completions', models: [], keyUrl: '',
    steps: ['填服务商给的接口地址（一般以 /v1 结尾）', '粘贴密钥', '点「测试连接」，能列出模型就勾选；列不出来就手动填模型名']},
]);
const PRESET_BY_ID = new Map(PRESETS.map(preset => [preset.id, preset]));
// 列模型时滤掉明显不是聊天用的（生图、语音、向量……）
const NON_CHAT = /(?:^|[-_/.])(?:embed(?:ding)?s?|rerank|tts|speech|whisper|transcribe|audio|image|imagine|dall-e|video|veo|moderation|ocr)(?:[-_/.]|$)/i;
const PROVIDER_ID = /^[a-z][a-z0-9-]{0,31}$/;
const MODEL_ID = /^[\w.:@~/+-]{1,160}$/;
const REGISTRY = 'pinkie-model-setup.json';

// 用户粘贴密钥时常带的首尾空格、引号、「Bearer 」前缀。
export function cleanKey(value) {
  let key = String(value ?? '').trim();
  for (let i = 0; i < 3; i++) key = key.replace(/^[\s"'“”‘’`]+|[\s"'“”‘’`]+$/g, '').replace(/^Bearer\s+/i, '');
  return key.replace(/[\r\n\t]/g, '');
}
export const keyTail = key => (key ? `••••${String(key).slice(-4)}` : '');
const scrub = (text, key) => (key && key.length >= 6 ? String(text).split(key).join('••••') : String(text));

function normalizeBase(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  let url;
  try { url = new URL(raw); } catch { throw Object.assign(new Error('接口地址不对：要以 http:// 或 https:// 开头'), {kind: 'input'}); }
  if (!/^https?:$/.test(url.protocol)) throw Object.assign(new Error('接口地址只支持 http / https'), {kind: 'input'});
  url.hash = ''; url.search = '';
  return url.toString().replace(/\/+$/, '');
}

// 错误说人话（PLAN B：401/403、402/余额、404/模型、超时/连不上）。
export function explainFailure({status, body = '', error, preset, model} = {}) {
  const text = String(body || '').toLowerCase();
  const intl = PRESET_BY_ID.get(preset)?.region === 'intl';
  if (error) {
    // 不把 TypeError、ECONNREFUSED 这类程序里的英文名给小白看，换成能照着做的话。
    const cause = error.cause?.errors?.[0] || error.cause || {};
    const code = String(error.code || cause.code || error.name || '');
    const proxy = intl ? '这是国外服务，可能需要打开代理再试。' : '请检查网络，或稍后再试。';
    if (/Timeout|Abort/i.test(code)) return {kind: 'network', message: `连接超时了。${proxy}`};
    if (/ENOTFOUND|EAI_AGAIN/.test(code)) return {kind: 'network', message: `找不到这个地址：接口地址可能写错了，或者网络没连上。${proxy}`};
    if (/ECONNREFUSED/.test(code)) return {kind: 'network', message: `这个地址没有服务在响应：检查接口地址和端口有没有写错，服务有没有打开。${intl ? proxy : ''}`};
    if (/CERT|SSL|TLS/i.test(code)) return {kind: 'network', message: `和这个地址的安全连接没建立起来（证书有问题）。${proxy}`};
    return {kind: 'network', message: `连不上这个服务商。${proxy}`};
  }
  if (status === 402 || /insufficient[_ ]?(balance|quota|credits?)|balance|arrearage|余额|欠费|credit/i.test(text)) {
    return {kind: 'balance', message: '账户余额不足或额度用完了：去服务商那里充值后再试。'};
  }
  if (status === 401 || status === 403 || /invalid[_ ]?api[_ ]?key|unauthori[sz]ed|incorrect api key|authentication/i.test(text)) {
    return {kind: 'auth', message: '密钥不对，或者这个账号还没开通服务：检查有没有复制完整、是不是这个服务商的密钥。'};
  }
  if (status === 404 || /model[_ ]?not[_ ]?found|does not exist|no such model|not found|invalid model|model.*(not|un)available|模型不存在/i.test(text)) {
    return {kind: 'model', message: model ? `模型「${model}」你的账号用不了（不存在或没开通）：换一个模型，或去服务商那里开通。` : '接口地址不对，或者这个服务商不支持列模型。'};
  }
  if (status === 429) return {kind: 'rate', message: '请求太频繁或被限流了，等一会儿再试。'};
  if (status >= 500) return {kind: 'server', message: `服务商那边出错了（${status}），稍后再试。`};
  return {kind: 'other', message: `服务商返回了错误（${status || '未知'}）。`};
}

async function call(fetchImpl, url, {key, method = 'GET', body, timeoutMs = 15000} = {}) {
  const response = await fetchImpl(url, {
    method, signal: AbortSignal.timeout(timeoutMs),
    headers: {Accept: 'application/json', ...(key ? {Authorization: `Bearer ${key}`} : {}), ...(body ? {'Content-Type': 'application/json'} : {})},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text().catch(() => '');
  let json = null; try { json = JSON.parse(text); } catch {}
  return {ok: response.ok, status: response.status, text: text.slice(0, 2000), json};
}

export const hasVisionInput = entry => Array.isArray(entry?.input) && entry.input.includes('image');

export function withVisionInput(input, vision) {
  const base = Array.isArray(input) ? input.filter(item => typeof item === 'string' && item) : [];
  const list = base.length ? base : ['text'];
  if (vision) {
    const next = [...list];
    if (!next.includes('text')) next.unshift('text');
    if (!next.includes('image')) next.push('image');
    return next;
  }
  const filtered = list.filter(item => item !== 'image');
  return filtered.length ? filtered : ['text'];
}

export function resolveConfiguredModel(cfg = {}, {providerId = '', modelId = '', model = ''} = {}) {
  const providers = cfg?.models?.providers || {};
  const pid = String(providerId || '').trim();
  const mid = String(modelId || '').trim();
  if (pid && mid) {
    const entry = (providers[pid]?.models || []).find(m => m && m.id === mid);
    if (!entry) throw new Error(`没有找到模型「${pid}/${mid}」（可能服务商还没配置或已被停用）`);
    return {providerId: pid, modelId: mid, entry};
  }
  const raw = String(model || '').trim();
  if (!raw) throw new Error('请提供要修改的模型名（例如 服务商/模型名）');
  const all = [];
  for (const [pKey, provider] of Object.entries(providers)) {
    for (const entry of Array.isArray(provider?.models) ? provider.models : []) {
      if (entry && typeof entry.id === 'string' && entry.id) all.push({providerId: pKey, modelId: entry.id, entry});
    }
  }
  if (!all.length) throw new Error('当前还没有配置任何模型，请先在「设置 → 模型服务」里添加服务商。');

  const lower = raw.toLowerCase();
  const fullExact = all.filter(item => `${item.providerId}/${item.modelId}` === raw);
  if (fullExact.length === 1) return fullExact[0];
  const fullLower = all.filter(item => `${item.providerId}/${item.modelId}`.toLowerCase() === lower);
  if (fullLower.length === 1) return fullLower[0];

  const idExact = all.filter(item => item.modelId === raw);
  if (idExact.length === 1) return idExact[0];
  if (idExact.length > 1) {
    throw new Error(`有多个服务商都有「${raw}」：${idExact.map(item => `${item.providerId}/${item.modelId}`).join('、')}，请写全「服务商/模型名」。`);
  }
  const idLower = all.filter(item => item.modelId.toLowerCase() === lower);
  if (idLower.length === 1) return idLower[0];
  if (idLower.length > 1) {
    throw new Error(`有多个服务商都有「${raw}」：${idLower.map(item => `${item.providerId}/${item.modelId}`).join('、')}，请写全「服务商/模型名」。`);
  }

  const nameLower = all.filter(item => typeof item.entry.name === 'string' && item.entry.name.trim().toLowerCase() === lower);
  if (nameLower.length === 1) return nameLower[0];
  if (nameLower.length > 1) {
    throw new Error(`有多个模型都叫「${raw}」：${nameLower.map(item => `${item.providerId}/${item.modelId}`).join('、')}，请写全「服务商/模型名」。`);
  }

  const defaults = cfg?.agents?.defaults?.model;
  const primary = typeof defaults === 'string' ? defaults : defaults?.primary || '';
  const similar = all
    .filter(item => `${item.providerId}/${item.modelId}`.toLowerCase().includes(lower) || String(item.entry.name || '').toLowerCase().includes(lower))
    .slice(0, 6)
    .map(item => `${item.providerId}/${item.modelId}`);
  const sample = (similar.length ? similar : all.slice(0, 10).map(item => `${item.providerId}/${item.modelId}`)).join('、');
  const defaultHint = primary ? `当前默认模型是 ${primary}；` : '';
  throw new Error(similar.length
    ? `没有找到完全叫「${raw}」的模型。${defaultHint}相近的有：${sample}。请写里面的「服务商/模型名」。`
    : `没有在已配置的服务商里找到模型「${raw}」。${defaultHint}已配置的模型有：${sample}${all.length > 10 ? ' 等' : ''}。`);
}

const modelEntry = (id, meta = {}) => {
  const window = Number(meta.context_window || meta.context_length || meta.contextWindow) || 128000;
  let input;
  if (typeof meta.vision === 'boolean') {
    input = withVisionInput(meta.input, meta.vision);
  } else if (Array.isArray(meta.input_modalities)) {
    input = meta.input_modalities.includes('image') ? ['text', 'image'] : ['text'];
  } else if (Array.isArray(meta.input) && meta.input.length) {
    input = [...meta.input];
  } else {
    input = ['text'];
  }
  // Always enable transport-level reasoning capture. If the provider returns no
  // reasoning_content/reasoning there is simply nothing to display.
  const entry = {id, name: meta.name && typeof meta.name === 'string' ? meta.name : id, reasoning: true, input, contextWindow: window, contextTokens: window};
  const max = Number(meta.max_output_tokens || meta.top_provider?.max_completion_tokens || meta.maxTokens);
  if (max > 0) entry.maxTokens = max;
  if (meta.compat && typeof meta.compat === 'object') entry.compat = structuredClone(meta.compat);
  return entry;
};

export function createModelSetup({config, fetchImpl = globalThis.fetch, stateDir, now = () => new Date()}) {
  const registryFile = stateDir ? path.join(stateDir, REGISTRY) : '';
  const readRegistry = () => {
    try {
      const data = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
      return {providers: data.providers || {}, disabled: data.disabled || {}, capabilities: data.capabilities || {}};
    }
    catch { return {providers: {}, disabled: {}, capabilities: {}}; }
  };
  const writeRegistry = data => {
    if (!registryFile) return;
    fs.mkdirSync(path.dirname(registryFile), {recursive: true});
    const temp = `${registryFile}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({providers: data.providers || {}, disabled: data.disabled || {}, capabilities: data.capabilities || {}}, null, 2) + '\n', {mode: 0o600});
    fs.renameSync(temp, registryFile);
  };
  const current = () => config.current() || {};

  async function test(params = {}) {
    const preset = PRESET_BY_ID.get(params.preset) || PRESET_BY_ID.get('custom');
    let key = cleanKey(params.apiKey);
    if (!key && params.providerId) key = String(current().models?.providers?.[params.providerId]?.apiKey || '');
    if (!key) return {ok: false, kind: 'input', message: '先粘贴密钥。'};
    let base;
    try { base = normalizeBase(params.baseUrl || preset.baseUrl); } catch (error) { return {ok: false, kind: 'input', message: error.message}; }
    const model = params.model ? String(params.model).trim() : '';
    const fail = (info) => ({ok: false, ...explainFailure({...info, preset: preset.id, model}), status: info.status || 0});
    let models = [], listed = false;
    try {
      // OpenRouter 的模型列表不要密钥，先单独验一下密钥本身。
      if (preset.keyCheck) {
        const check = await call(fetchImpl, base + preset.keyCheck, {key});
        if (!check.ok) return fail({status: check.status, body: scrub(check.text, key)});
      }
      const list = await call(fetchImpl, `${base}/models`, {key});
      if (list.ok && Array.isArray(list.json?.data)) {
        listed = true;
        models = list.json.data.filter(row => row && typeof row.id === 'string' && MODEL_ID.test(row.id) && !NON_CHAT.test(row.id))
          .map(row => ({id: row.id, name: typeof row.name === 'string' ? row.name : row.id, meta: {context_window: row.context_window || row.context_length, max_output_tokens: row.max_output_tokens, input_modalities: row.input_modalities || row.architecture?.input_modalities}}))
          .slice(0, 400);
      } else if (list.status !== 404 && list.status !== 405) {
        return fail({status: list.status, body: scrub(list.text, key)});
      }
      // 列不了模型（有些服务商没有这个接口），或者用户点名要验一个模型：发一句极短对话。
      const probe = model || (!listed ? preset.models[0] : '');
      if (probe) {
        const chat = await call(fetchImpl, `${base}/chat/completions`, {key, method: 'POST', timeoutMs: 30000,
          body: {model: probe, messages: [{role: 'user', content: '回一个字：好'}], max_tokens: 8, stream: false}});
        if (!chat.ok) return {...fail({status: chat.status, body: scrub(chat.text, key)}), model: probe, models: models.map(({id, name, meta}) => ({id, name, vision: Boolean(Array.isArray(meta?.input_modalities) && meta.input_modalities.includes('image')), ...(meta ? {meta} : {})}))};
        if (!listed) models = preset.models.map(id => ({id, name: id}));
      }
    } catch (error) {
      return fail({error});
    }
    const recommended = preset.models.filter(id => !listed || models.some(row => row.id === id));
    return {ok: true, listed, baseUrl: base, models: models.map(({id, name, meta}) => ({id, name, vision: Boolean(Array.isArray(meta?.input_modalities) && meta.input_modalities.includes('image')), ...(meta ? {meta} : {})})), recommended,
      message: listed ? `连上了，这个账号能用 ${models.length} 个聊天模型。` : '连上了（这个服务商不提供模型列表，先用推荐的模型）。'};
  }

  function list() {
    const cfg = current();
    const providers = cfg.models?.providers || {};
    const registry = readRegistry();
    const defaults = cfg.agents?.defaults?.model;
    const primary = typeof defaults === 'string' ? defaults : defaults?.primary || '';
    const rows = Object.entries(providers).map(([id, provider]) => ({
      id, preset: registry.providers[id]?.preset || '', label: registry.providers[id]?.label || PRESET_BY_ID.get(registry.providers[id]?.preset)?.label || id,
      baseUrl: provider?.baseUrl || '', keyTail: keyTail(provider?.apiKey), hasKey: Boolean(provider?.apiKey),
      models: (provider?.models || []).map(m => ({id: m.id, name: m.name || m.id, vision: hasVisionInput(m), input: Array.isArray(m.input) ? [...m.input] : ['text']})).slice(0, 400), modelCount: (provider?.models || []).length,
      enabled: true, managed: Boolean(registry.providers[id]),
      isDefault: primary.startsWith(`${id}/`),
    }));
    for (const [id, saved] of Object.entries(registry.disabled)) {
      rows.push({id, preset: registry.providers[id]?.preset || '', label: registry.providers[id]?.label || id, baseUrl: saved?.baseUrl || '',
        keyTail: keyTail(saved?.apiKey), hasKey: Boolean(saved?.apiKey), models: [], modelCount: (saved?.models || []).length, enabled: false, managed: true, isDefault: false});
    }
    const usable = rows.some(row => row.enabled && row.modelCount && (row.hasKey || /^http:\/\/(127\.0\.0\.1|localhost)/.test(row.baseUrl)));
    return {providers: rows, defaultModel: primary, needsSetup: !usable};
  }

  const mutate = (fn) => config.mutateConfigFile({base: 'source', afterWrite: {mode: 'auto'}, mutate: fn});

  function applyDefault(draft, model, everywhere) {
    draft.agents ||= {}; draft.agents.defaults ||= {};
    const before = draft.agents.defaults.model;
    draft.agents.defaults.model = typeof before === 'object' && before ? {...before, primary: model} : {primary: model};
    if (everywhere && Array.isArray(draft.agents.list)) {
      for (const agent of draft.agents.list) {
        if (!agent || agent.id === 'unrestricted' || agent.model === undefined) continue;
        agent.model = typeof agent.model === 'object' && agent.model ? {...agent.model, primary: model} : model;
      }
    }
  }

  async function save(params = {}) {
    const preset = PRESET_BY_ID.get(params.preset) || PRESET_BY_ID.get('custom');
    const providers = current().models?.providers || {};
    const registry = readRegistry();
    const editing = params.providerId ? String(params.providerId) : '';
    if (editing && !providers[editing]) throw new Error('要编辑的服务商不存在（可能被停用了）');
    const id = editing || (() => {
      const base = PROVIDER_ID.test(preset.id) ? preset.id : 'custom';
      for (let n = 1; n < 100; n++) { const candidate = n === 1 ? base : `${base}-${n}`; if (!providers[candidate] && !registry.disabled[candidate]) return candidate; }
      throw new Error('服务商太多了');
    })();
    const key = cleanKey(params.apiKey) || (editing ? String(providers[editing]?.apiKey || '') : '');
    if (!key) throw new Error('先粘贴密钥');
    const baseUrl = normalizeBase(params.baseUrl || providers[editing]?.baseUrl || preset.baseUrl);
    const chosen = (Array.isArray(params.models) ? params.models : []).map(row => (typeof row === 'string' ? {id: row} : row))
      .filter(row => row && MODEL_ID.test(String(row.id || ''))).slice(0, 200);
    if (!chosen.length) throw new Error('至少选一个模型');
    const existingById = new Map((editing ? providers[editing]?.models || [] : []).map(m => [m.id, m]));
    const entries = chosen.map(row => {
      const prev = existingById.get(String(row.id));
      const meta = {
        ...(prev ? {contextWindow: prev.contextWindow, maxTokens: prev.maxTokens, input: prev.input, compat: prev.compat} : {}),
        ...(row.meta && typeof row.meta === 'object' ? row.meta : {}),
        ...(row.name ? {name: row.name} : prev?.name ? {name: prev.name} : {}),
        ...(typeof row.vision === 'boolean' ? {vision: row.vision} : {}),
      };
      return modelEntry(String(row.id), meta);
    });
    const defaultModel = params.defaultModel && chosen.some(row => row.id === params.defaultModel) ? `${id}/${params.defaultModel}` : '';
    await mutate(draft => {
      draft.models ||= {}; draft.models.providers ||= {};
      const before = draft.models.providers[id] || {};
      draft.models.providers[id] = {...before, baseUrl, apiKey: key, api: before.api || preset.api, models: entries};
      if (defaultModel) applyDefault(draft, defaultModel, params.everywhere !== false);
    });
    registry.providers[id] = {preset: preset.id, label: String(params.label || '').trim().slice(0, 40) || preset.label, updatedAt: now().toISOString()};
    for (const row of chosen) {
      if (typeof row.vision === 'boolean') registry.capabilities[`${id}/${row.id}`] = {vision: row.vision, updatedAt: now().toISOString()};
    }
    writeRegistry(registry);
    return {ok: true, providerId: id, defaultModel, ...list()};
  }

  async function setCapability(params = {}) {
    if (typeof params.vision !== 'boolean') throw new Error('请明确说明是要打开还是关闭看图能力（vision 需为 true 或 false）');
    const vision = params.vision;
    const target = resolveConfiguredModel(current(), params);
    let updated = null;
    await mutate(draft => {
      const provider = draft.models?.providers?.[target.providerId];
      const entry = Array.isArray(provider?.models) ? provider.models.find(m => m && m.id === target.modelId) : null;
      if (!entry) throw new Error(`模型「${target.providerId}/${target.modelId}」已经不在配置里了`);
      const beforeVision = hasVisionInput(entry);
      const nextInput = withVisionInput(entry.input, vision);
      entry.input = nextInput;
      updated = {
        model: `${target.providerId}/${target.modelId}`,
        providerId: target.providerId,
        modelId: target.modelId,
        name: entry.name || target.modelId,
        vision,
        changed: beforeVision !== vision,
        input: [...nextInput],
      };
    });
    const registry = readRegistry();
    registry.capabilities[`${updated.providerId}/${updated.modelId}`] = {vision, updatedAt: now().toISOString()};
    writeRegistry(registry);
    return {ok: true, ...updated, ...list()};
  }

  async function setDefault(params = {}) {
    const model = String(params.model || '');
    const [providerId, ...rest] = model.split('/');
    const provider = current().models?.providers?.[providerId];
    if (!provider || !rest.length || !(provider.models || []).some(m => m.id === rest.join('/'))) throw new Error('这个模型不在已配置的服务商里');
    await mutate(draft => applyDefault(draft, model, params.everywhere !== false));
    return {ok: true, ...list()};
  }

  async function disable(params = {}) {
    const id = String(params.providerId || '');
    const registry = readRegistry();
    if (!registry.providers[id]) throw new Error('只能停用在这里添加的服务商');
    let saved = null;
    await mutate(draft => {
      saved = draft.models?.providers?.[id];
      if (!saved) throw new Error('服务商不存在');
      if (String(draft.agents?.defaults?.model?.primary || draft.agents?.defaults?.model || '').startsWith(`${id}/`)) throw new Error('它正在当默认模型：先把默认换成别的，再停用');
      delete draft.models.providers[id];
    });
    registry.disabled[id] = saved;
    writeRegistry(registry);
    return {ok: true, ...list()};
  }

  async function enable(params = {}) {
    const id = String(params.providerId || '');
    const registry = readRegistry();
    const saved = registry.disabled[id];
    if (!saved) throw new Error('没有找到停用的服务商');
    await mutate(draft => { draft.models ||= {}; draft.models.providers ||= {}; draft.models.providers[id] = saved; });
    delete registry.disabled[id];
    writeRegistry(registry);
    return {ok: true, ...list()};
  }

  async function remove(params = {}) {
    const id = String(params.providerId || '');
    const registry = readRegistry();
    if (!registry.providers[id]) throw new Error('只能删除在这里添加的服务商');
    if (registry.disabled[id]) delete registry.disabled[id];
    else await mutate(draft => {
      if (String(draft.agents?.defaults?.model?.primary || draft.agents?.defaults?.model || '').startsWith(`${id}/`)) throw new Error('它正在当默认模型：先把默认换成别的，再删除');
      if (draft.models?.providers) delete draft.models.providers[id];
    });
    delete registry.providers[id];
    for (const key of Object.keys(registry.capabilities || {})) {
      if (key.startsWith(`${id}/`)) delete registry.capabilities[key];
    }
    writeRegistry(registry);
    return {ok: true, ...list()};
  }

  const presets = () => ({presets: PRESETS.map(({id, label, region, baseUrl, models, keyUrl, steps}) => ({id, label, region, baseUrl, models, keyUrl, steps}))});
  return {presets, list, test, save, setCapability, setDefault, disable, enable, remove};
}

export function createModelCapabilityTool(setup) {
  return {
    name: 'pinkie_model_capability',
    label: '设置模型看图能力',
    description: '只做一件事：打开或关闭某个已有模型能不能看图片（修改该模型条目里的 input 是否包含 image），不碰其他配置。内部走和「设置 → 模型服务」同一条安全保存通道。打开后必须提醒用户：已打开，如果上游其实不支持，发图时会报错，可以再关掉。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        model: {
          type: 'string',
          minLength: 1,
          description: '要改的已有模型（写「服务商/模型名」或单独的模型名，例如 deepseek/deepseek-chat、mm/workbuddy/hy4flash）。不确定准确名字时传你想找的模型名关键字，报错会列出已配好的模型名。',
        },
        vision: {
          type: 'boolean',
          description: 'true = 打开「能看图片」；false = 关闭「能看图片」。',
        },
      },
      required: ['model', 'vision'],
    },
    async execute(_toolCallId, params = {}) {
      try {
        const res = await setup.setCapability({model: params.model, vision: params.vision});
        const payload = {
          ok: true,
          model: res.model,
          name: res.name,
          vision: res.vision,
          changed: res.changed,
          input: res.input,
          message: res.vision
            ? `已打开「${res.model}」的看图能力。请告诉用户：已打开，如果上游其实不支持，发图时会报错，可以再关掉。`
            : `已关闭「${res.model}」的看图能力。`,
        };
        return {content: [{type: 'text', text: JSON.stringify(payload, null, 2)}], details: payload, isError: false};
      } catch (error) {
        const payload = {ok: false, error: error instanceof Error ? error.message : String(error)};
        return {content: [{type: 'text', text: JSON.stringify(payload, null, 2)}], details: payload, isError: true};
      }
    },
  };
}

export function supplementMinimalModelCapability(config) {
  const tools = config?.tools;
  if (!tools || tools.profile !== 'minimal' || Object.hasOwn(tools, 'allow')
      || tools.alsoAllow !== undefined && !Array.isArray(tools.alsoAllow)) return false;
  const present = new Set((tools.alsoAllow || []).map(name => String(name).toLowerCase()));
  if (present.has('pinkie_model_capability')) return false;
  tools.alsoAllow = [...(tools.alsoAllow || []), 'pinkie_model_capability'];
  return true;
}

export function registerModelSetup(api) {
  let stateDir = '';
  try { stateDir = api.runtime.state.resolveStateDir(); } catch {}
  const setup = createModelSetup({config: api.runtime.config, stateDir});
  for (const [name, scope] of [['presets', 'operator.read'], ['list', 'operator.read'], ['test', 'operator.admin'], ['save', 'operator.admin'],
    ['setCapability', 'operator.admin'], ['setDefault', 'operator.admin'], ['disable', 'operator.admin'], ['enable', 'operator.admin'], ['remove', 'operator.admin']]) {
    api.registerGatewayMethod(`pinkie.modelSetup.${name}`, async ({params, respond}) => {
      try { respond(true, await setup[name](params || {})); }
      // 只回错误说明，不回参数（里面有密钥）。
      catch (error) { respond(false, undefined, {code: 'INVALID_REQUEST', message: scrub(String(error?.message || error), cleanKey(params?.apiKey))}); }
    }, {scope});
  }
  const config = api.runtime?.config;
  if (config?.current && config?.mutateConfigFile && api.on) {
    api.on('gateway_start', async () => {
      try {
        if (!supplementMinimalModelCapability(structuredClone(config.current() || {}))) return;
        await config.mutateConfigFile({base: 'source', afterWrite: {mode: 'auto'}, mutate: supplementMinimalModelCapability});
      } catch {
        api.logger?.warn?.('[model-setup] 无法补齐只聊天下的看图设置工具权限');
      }
    });
  }
  return setup;
}
