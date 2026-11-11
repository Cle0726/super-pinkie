import fs from 'node:fs';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';
import {CompanionAssistant, TITLE_MODEL} from './companion.mjs';
import {expandHome, openclawStateDir, runtimeConfig} from './openclaw-paths.mjs';

const segmenter = new Intl.Segmenter(undefined, {granularity: 'grapheme'});
const INVALID_UNICODE = /[\uD800-\uDFFF\uFFFD]/gu;
const INVISIBLE = /[\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu;
const CONTROLS = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
const MAIN_SESSION = /^agent:[^:]+:main$/i;
const SESSION_KEY = /^agent:([a-z\d][a-z\d_-]*):[^\s\p{Cc}]+$/iu;
const EMPTY_TITLE = /^(?:.+?\s*·\s*)?(?:新会话(?:\s*\d+)?|会话\s*\d+|New session(?:\s*\d+)?|Untitled)$/iu;
const BAD_TITLE = /^(?:(?:ou|on|oc|om|wxid|wm|cid|ding|dt)_|\[(?:pinkie-[\w-]+|System)\]|agent:|[0-9a-f]{8}\b)|\s·\s[0-9a-f]{4}$|[\uD800-\uDFFF\uFFFD]/iu;
const CHANNEL_ID = /^(?:(?:ou|on|oc|om|wxid|wm|cid|ding|dt)_|(?:direct|dm|group|channel):|[0-9a-f]{8}\b|\+?\d{5,}$)|@chatroom$|^[A-Za-z0-9_-]{24,}$/iu;
const CHANNELS = {feishu: '飞书', 'openclaw-weixin': '微信', weixin: '微信', dingtalk: '钉钉'};
const LOW_INFORMATION = /^(?:(?:hi|hey|hello)(?:there|pinkie|碧琪)?|ping|test(?:ing)?\d*|ok(?:ay)?|thanks|thankyou|gotit|yes|yep|sure|continue|goon|你好(?:呀|啊|吗|么|碧琪)?|您好|在(?:吗|不在|不)|嗨|哈[喽啰]|[嗯哦啊]+|测试(?:一下|哈)?\d*|好的?|收到|知道了|可以|对|继续(?:吧|啊|呀)?|接着|明白了|谢谢|早上好|晚安)$/iu;
const FILLER = /^(?:(?:你(?:能不能|可以|帮我)|请(?:你|帮我)?|帮我|帮忙|麻烦(?:你)?|我[想要]|我需要|我希望|去|先看|看看|看一下|查一下|问一下|研究一下|想了解|想问|想|为什么|如何|怎么(?:样|办)?|能不能|能否|实现|做一个|给我|给出)[\s，、,:：]*|(?:please|can you|could you|would you|help me|i want to|i need to|how (?:do|can) i|explain (?:why|how)|what are some(?: simple)? ways to|take a look at|look into|investigate|implement)\b[\s,:-]*)/iu;
const INJECTION = /(?:(?:忽略|无视|忘掉).{0,20}(?:之前|以上|前面|指令|要求).{0,40}标题|ignore\b.{0,60}(?:previous|prior|above|instructions).{0,70}\btitle\b)/iu;

export const INTERNAL_MESSAGE_PREFIXES = Object.freeze([
  '[pinkie-watchdog]', '[pinkie-tier-control]', '[pinkie-tier]', '[pinkie-integrity]',
  '[pinkie-marathon]', '[pinkie-session-wake]', '[pinkie-session-message]', '[System]',
  'Your previous turn was interrupted by a gateway restart', '【自动续接保护】',
  '【压缩续工恢复】', '【全局交付真实性门禁】', '【档位控制器】',
  'A background task completed.', 'Continue the OpenClaw runtime event',
  'Before accepting the previous final answer, apply this revision request',
  '[Internal task completion event]', 'Pre-compaction memory flush',
  'Read HEARTBEAT.md if it exists', '<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>', '\u2063',
]);

export function clipGraphemes(value, limit) {
  let result = '';
  for (const {segment} of segmenter.segment(value)) {
    if (limit-- <= 0) break;
    result += segment;
  }
  return result;
}

export function graphemeCount(value, stopAfter = Infinity) {
  let count = 0;
  for (const _ of segmenter.segment(value)) if (++count > stopAfter) break;
  return count;
}

export function safeText(value) {
  return typeof value === 'string' ? value.replace(INVALID_UNICODE, '').replace(INVISIBLE, '') : '';
}

export function messageText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(part => typeof part === 'string' ? part
    : ['text', 'input_text', 'output_text'].includes(part?.type) ? part.text || part.content || '' : '').join('\n');
  return value && typeof value === 'object' ? messageText(value.content ?? value.text ?? value.message ?? '') : '';
}

export const agentOf = key => typeof key === 'string' && key.length <= 512 ? SESSION_KEY.exec(key)?.[1] || '' : '';
export const isPersona = key => /:subagent:/i.test(key || '');
export const isUnresolvedSessionKey = key => /(?:^|:)unknown$/i.test(key || '');
export const isInternalSessionKey = key => isUnresolvedSessionKey(key)
  || /:(?:structured-gap|failed-tool-result)$|:internal-session-effects:/i.test(key || '');

export function isLowInformation(value) {
  const effective = value.replace(/[^\p{L}\p{N}]/gu, '');
  return graphemeCount(effective, 3) < 4 || LOW_INFORMATION.test(effective);
}

// Keep the corresponding title test in laolao-session-list.js in sync.
export function isBadTitle(value, key = '', sessionId = '') {
  const title = String(value || '').trim();
  return !title || EMPTY_TITLE.test(title) || BAD_TITLE.test(title) || isLowInformation(title)
    || [String(key).split(':').pop(), String(sessionId)].filter(Boolean).some(id => title === id);
}

function stripEnvelope(value) {
  return value.replace(/^(?:\s*(?:Conversation info|Sender|Chat history|Replied message|Forwarded message)(?: \(untrusted metadata\))?:\s*\n[ \t]*```[^\n]*\n[\s\S]*?^\s*```[ \t]*(?:\n|$))+/gim, '')
    .replace(/\[(?:message_id|media attached|timestamp|sender_id):[^\]\r\n]*\]/giu, '')
    .replace(/^[ \t]*(?:\[(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+)?\d{4}-\d{2}-\d{2}[^\]\n]*\][ \t]*)+/gim, '')
    .replace(/^[ \t]*(?:ou|on|oc|wxid|wm|cid|ding|dt)_[\w-]+\s*[:：][ \t]*/gim, '')
    .replace(/^\s*【来自关联会话的消息】\s*/u, '');
}

export function isInternalMessage(value) {
  const text = stripEnvelope(messageText(value)).trimStart();
  return INTERNAL_MESSAGE_PREFIXES.some(prefix => text.toLowerCase().startsWith(prefix.toLowerCase()));
}

export function cleanTitleSource(value) {
  if (isInternalMessage(value)) return '';
  const raw = stripEnvelope(messageText(value)).replace(/\u200D/gu, '');
  return safeText(raw.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, ' '))
    .replace(/https?:\/\/[^\s<>"'`，。！？、；）\]]+/giu, url => {
      try { return new URL(url).hostname; } catch { return ''; }
    })
    .replace(/(?:[a-z]:[\\/]|~\/|\.{1,2}\/|(?<![\p{L}\p{N}.])\/)(?:[^\s\\/，。！？、；:"'<>]+[\\/])+([^\s\\/，。！？、；:"'<>]+)/giu, '$1')
    .replace(/^\s*(?:[#>*-]+|\d+[.)])\s*/gm, '')
    .replace(CONTROLS, ' ').replace(/\s+/gu, ' ').trim();
}

const unquote = value => value.trim().replace(/^["'“”‘’「」『』《》]+|["'“”‘’「」『』《》]+$/gu, '').trim();
const looksInjected = value => INJECTION.test(value);
const usesCjk = value => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value);

export function validateTitle(raw, sources = []) {
  if (typeof raw !== 'string' || /[\r\n\u2028\u2029\uD800-\uDFFF\uFFFD]/u.test(raw)) return '';
  const title = unquote(safeText(raw)).normalize('NFC');
  if (isBadTitle(title) || /(?:抱歉|无法|作为\s*AI|\bas an AI\b|\bI(?:\s+(?:can['’]t|cannot|am sorry)|['’]m sorry)|^(?:标题|title)\s*[:：])/iu.test(title)) return '';
  if (/["“”「」『』《》。\p{Extended_Pictographic}]|\p{Cc}|[.!?！？]$/u.test(title)) return '';
  const limit = usesCjk(title) ? 16 : 48;
  if (graphemeCount(title, limit) > limit) return '';
  const candidate = title.replace(/(?:…|\.{3})$/u, '').trim().toLowerCase();
  for (const source of sources) {
    const input = source.toLowerCase();
    if (graphemeCount(source, 16) > 16 && input.startsWith(candidate)) return '';
    if (looksInjected(source) && !/(?:提示|指令|注入|prompt|instruction|inject)/iu.test(candidate)) return '';
  }
  return title;
}

export function heuristicTitle(source) {
  if (looksInjected(source)) return usesCjk(source) ? '标题提示注入' : 'Title Prompt Injection';
  let text = source.replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200D\uFE0F]/gu, '').trim()
    .replace(/^(?:碧琪|小碧琪|Pinkie)[，,：:]\s*/iu, '');
  let previous;
  do {
    previous = text;
    text = text.replace(FILLER, '');
  } while (text && text !== previous);
  text = unquote(text || source)
    .replace(/^(?:一个办法[，,]|.{1,20}?(?:有(?:没有|什么)办法)(?:可以|能)?)\s*/u, '')
    .replace(/^(?:my|our)\s+/iu, '');
  const clauses = text.split(/[，、；。！？!?;]|,\s|\s[—–]\s|\.(?:\s|$)/u);
  let phrase = clauses.map(clause => clause.trim()).find(clause => !isLowInformation(clause)) || text;
  // In a timing report the symptom is usually after the condition.
  // Keep that clause when it describes an observable failure.
  const symptom = /(?:之前|之后|以后|的时候|时)([^，。]+(?:消失|断流|断开|失败|报错|出错|卡顿|崩溃|闪退|超时|没反应|不见了))$/u.exec(phrase)?.[1];
  if (symptom && !isLowInformation(symptom)) {
    phrase = symptom.replace(/^(?:碧琪|应用|系统)的/u, '')
      .replace(/(?:内容)?(?:就|都|总是|一直)?会(?=消失|断流|断开|失败|报错|出错|卡顿|崩溃|闪退|超时)/u, '');
  }
  if (graphemeCount(phrase, 16) <= 16) return phrase;
  const prefix = clipGraphemes(phrase, 16);
  const boundary = prefix.lastIndexOf(' ');
  if (phrase.startsWith(prefix + ' ')) return prefix;
  if (boundary > 0 && graphemeCount(prefix.slice(0, boundary)) >= 5) return prefix.slice(0, boundary);
  return clipGraphemes(phrase, 15).trimEnd() + '…';
}

export function channelTitle(entry = {}, key = entry.key) {
  const origin = entry.origin || {};
  if (/^(?:webchat|internal)$/iu.test(origin.provider || '')) return null;
  const parts = String(key || '').split(':');
  const fromKey = parts.length >= 5 && /^(?:direct|dm|group|channel|room)$/i.test(parts[3]) ? parts[2] : '';
  const route = String(origin.provider || entry.channel || '').toLowerCase();
  const channel = Object.hasOwn(CHANNELS, parts[2]) ? parts[2] : fromKey || route;
  if (!channel || /^(?:webchat|internal|unknown|dashboard|subagent|cron)$/iu.test(channel)
      || !/^[\da-z_-]+$/iu.test(channel)) return null;
  const provider = CHANNELS[channel] || channel;
  const kind = [origin.chatType, entry.chatType, parts[3]].some(type => /^(?:group|channel|room)$/iu.test(type || '')) ? '群聊' : '私聊';
  const label = safeText(origin.label).replace(CONTROLS, ' ').trim();
  const person = label && !CHANNEL_ID.test(label) && !EMPTY_TITLE.test(label) && !BAD_TITLE.test(label) && label !== entry.sessionId
    ? clipGraphemes(label, 32) : '';
  return {channel, title: person ? provider + ' · ' + person : provider + kind};
}

function legacySentence(raw) {
  // Match the historical algorithm exactly. Its UTF-16 length is used only
  // to recognize labels already on disk, never to produce a new label.
  const cleaned = raw.replace(/```[\s\S]*?```/g, ' ').replace(/https?:\/\/\S+/g, ' ')
    .replace(/[\u200B-\u200D\u2060\u2063\u2064\uFEFF]/g, ' ')
    .replace(/^\s*(?:[#>*-]|\d+[.)])\s*/gm, '').replace(/\s+/g, ' ').trim();
  return cleaned.split(/[。！？!?\n]/, 1)[0].trim() || cleaned;
}

export function matchesLegacyTitle(label, raw) {
  const stored = label.replace(/\s·\s[\da-f]{4}$/i, '');
  const sentence = legacySentence(raw);
  if (!sentence) return false;
  if (sentence.length <= 28) return stored === sentence;
  if (!stored.endsWith('…')) return false;
  const prefix = stored.slice(0, -1);
  return sentence.startsWith(prefix) && prefix.length <= 27 && !sentence.slice(prefix.length, 27).trim();
}

async function* transcriptMessages(file) {
  if (!file) return;
  const input = fs.createReadStream(file, {encoding: 'utf8', highWaterMark: 32_768});
  const lines = createInterface({input, crlfDelay: Infinity});
  try {
    for await (const line of lines) {
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (record?.type === 'message' && record.message) yield record.message;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  } finally {
    lines.close();
    input.destroy();
  }
}

export async function readTitleTranscript(file, legacyLabel = '', summaryOnly = false) {
  const sources = [];
  let firstReply = '', users = 0, internalUsers = 0, messages = 0, legacy = false;
  let greetings = 0, greetingPending = false;
  for await (const message of transcriptMessages(file)) {
    messages++;
    if (message.role === 'user') {
      if (isInternalMessage(message)) { internalUsers++; continue; }
      users++;
      if (summaryOnly) break;
      const raw = messageText(message);
      if (legacyLabel && users <= 12 && matchesLegacyTitle(legacyLabel, raw)) legacy = true;
      const clean = cleanTitleSource(raw);
      greetingPending = isLowInformation(clean);
      if (!greetingPending && sources.length < 3) sources.push(clipGraphemes(clean, 1500));
    } else if (message.role === 'assistant' && users && !/^(?:toolUse|tool_use|error|abort(?:ed)?|cancel(?:led)?)$/i.test(message.stopReason || '')) {
      const reply = messageText(message).trim();
      if (!reply || /^(?:NO_REPLY|HEARTBEAT_OK)$/u.test(reply)) continue;
      if (!firstReply) firstReply = clipGraphemes(cleanTitleSource(reply), 300);
      if (greetingPending) greetings++;
      greetingPending = false;
    }
    if (sources.length >= 3 && (!legacyLabel || legacy || users >= 12)
        && (firstReply || graphemeCount(sources.join('\n'), 19) >= 20)) break;
  }
  return {sources, firstReply, greetings, legacy, messages, internal: internalUsers > 0 && users === 0};
}

export function readSessionJson(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
    throw new Error('invalid-session-store');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

export function writeSessionJson(file, data) {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', {mode: 0o600});
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, {force: true});
  }
}

function runtimeDist(cli) {
  if (process.env.PINKIE_OPENCLAW_RUNTIME) return process.env.PINKIE_OPENCLAW_RUNTIME;
  if (!cli) return '';
  return path.basename(cli) === 'openclaw.mjs' ? path.join(path.dirname(cli), 'dist') : path.dirname(cli);
}

export function createSessionAccess(api, {cli, runProcess} = {}) {
  const dist = runtimeDist(cli);
  const sdk = name => dist ? import(pathToFileURL(path.join(dist, 'plugin-sdk', name + '.js')).href).catch(() => null) : null;
  let gateway, sessionStore;
  async function rpc(method, params) {
    gateway ??= Promise.resolve(sdk('gateway-runtime'));
    const direct = (await gateway)?.callGatewayFromCli;
    if (direct) return direct(method, {json: true, timeout: '15000'}, params);
    if (!cli || !runProcess) throw new Error('session-gateway-unavailable');
    const {stdout} = await runProcess(process.execPath, [cli, 'gateway', 'call', method,
      '--params', JSON.stringify(params), '--json', '--timeout', '15000'],
    {timeout: 17_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: process.env});
    return JSON.parse(stdout);
  }
  async function list(agentId) {
    const configured = runtimeConfig(api).session?.store;
    const file = configured
      ? path.resolve(expandHome(configured.replaceAll('{agentId}', agentId)))
      : path.join(openclawStateDir(), 'agents', agentId, 'sessions', 'sessions.json');
    sessionStore ??= Promise.resolve(sdk('session-store-runtime'));
    const getEntries = (await sessionStore)?.listSessionEntries;
    const records = getEntries ? await getEntries({agentId, storePath: file, hydrateSkillPromptRefs: false}) : null;
    const entries = records ? Object.fromEntries(records.map(({sessionKey, entry}) => [sessionKey, entry])) : readSessionJson(file);
    return {entries, dir: path.dirname(file)};
  }
  async function entry(key) {
    const agentId = agentOf(key);
    if (!agentId) return null;
    const {entries, dir} = await list(agentId);
    return sessionEntry(entries, dir, key);
  }
  return {rpc, list, entry};
}

function sessionEntry(entries, dir, key) {
  const data = entries[key];
  if (!data?.sessionId) return null;
  return {...data, key, transcript: path.resolve(dir, data.sessionFile || data.sessionId + '.jsonl')};
}

export function logSessionFailure(api, topic, key, reason) {
  // Provider / gateway errors can contain the user's text. Only log a category.
  api.logger?.warn?.(`[${topic}] key=${agentOf(key) ? key : '?'} reason=${reason}`);
}

const SAME_LABEL = /label already in use/i;
export function numberedTitle(title, ordinal, limit = 80) {
  if (ordinal === 1) return title;
  const suffix = `（${ordinal}）`;
  return clipGraphemes(title, limit - graphemeCount(suffix)).trimEnd() + suffix;
}

const SYSTEM_TITLE = (key, label) => isPersona(key) || /:desk-chat(?:[:.-]|$)/iu.test(key) && /^开始上课[：:]/u.test(label);
const MAX_ATTEMPTS = 3;
const ENSURE_LIMIT = 20;
const ENSURE_INTERVAL_MS = 150;
const ensureSleep = () => new Promise(resolve => setTimeout(resolve, ENSURE_INTERVAL_MS));
const fingerprint = text => createHash('sha256').update(text).digest('hex');

export class SessionTitles {
  constructor(api, {root, access, assistant = new CompanionAssistant(api, {root}), delay = ensureSleep}) {
    this.api = api;
    this.access = access;
    this.assistant = assistant;
    this.file = path.join(root, 'session-titles.json');
    this.delay = delay;
    this.queue = new Map();
    this.running = false;
    this.writes = new Map();
    this.summaryCache = new Map();
  }

  record(key, patch) {
    const data = readSessionJson(this.file);
    if (!patch) return data[key];
    const next = {title: '', source: 'legacy', basisHash: '', attempts: 0, ...data[key], ...patch, at: Date.now(), v: 1};
    data[key] = next;
    writeSessionJson(this.file, data);
    return next;
  }

  serial(key, fn) {
    const run = (this.writes.get(key) || Promise.resolve()).catch(() => {}).then(fn);
    this.writes.set(key, run);
    return run.finally(() => { if (this.writes.get(key) === run) this.writes.delete(key); });
  }

  async persistLabel(entry, title, source, patch = {}) {
    return this.serial(entry.key, async () => {
      const current = await this.access.entry(entry.key);
      if (!current || current.sessionId !== entry.sessionId) return null;
      const previous = this.record(entry.key);
      if (source !== 'user' && (current.label !== entry.label || previous?.source === 'user'
          || (source !== 'system' && previous?.source === 'system'))) return null;
      const agentId = agentOf(entry.key);
      const limit = source === 'auto' ? (usesCjk(title) ? 16 : 48) : source === 'heuristic' ? 16 : 80;
      for (let ordinal = 1; ordinal <= 100; ordinal++) {
        const label = numberedTitle(title, ordinal, limit);
        try {
          if (current.label !== label) await this.access.rpc('sessions.patch', {key: entry.key, agentId, label});
          return this.record(entry.key, {...patch, title: label, source});
        } catch (error) {
          if (!SAME_LABEL.test(error.message) || source === 'user') throw error;
        }
      }
      throw new Error('title-conflict-limit');
    });
  }

  async rename(key, raw, source) {
    if (!agentOf(key) || isInternalSessionKey(key) || isPersona(key)) throw new Error('这条会话不能改名');
    const entry = await this.access.entry(key);
    if (!entry) throw new Error('找不到这条会话');
    if (source === 'auto') {
      const record = this.record(key);
      if (record?.source === 'user' || (!record && entry.label && !isBadTitle(entry.label, key, entry.sessionId)
          && !(await readTitleTranscript(entry.transcript, entry.label)).legacy)) throw new Error('用户自己起的名，不改');
      if (record?.source === 'system' || SYSTEM_TITLE(key, entry.label || '') || channelTitle(entry, key)) throw new Error('这条会话使用固定名称');
      const basis = await readTitleTranscript(entry.transcript);
      const title = validateTitle(raw, basis.sources);
      if (!title) throw new Error('请用简短的主题名');
      return this.persistLabel(entry, title, source, {basisHash: fingerprint(basis.sources.join('\n'))});
    }
    const title = safeText(raw).replace(CONTROLS, ' ').trim().normalize('NFC');
    if (!title || graphemeCount(title, 80) > 80) throw new Error('会话名称需要 1 到 80 个字');
    return this.persistLabel(entry, title, source);
  }

  enqueue(keys) {
    let accepted = 0;
    for (const key of keys) {
      if (!agentOf(key) || isPersona(key) || isInternalSessionKey(key) || this.queue.size >= 120) continue;
      if (this.queue.has(key)) continue;
      this.queue.set(key, true);
      accepted++;
    }
    if (!this.running && this.queue.size) void this.drain();
    return {accepted};
  }

  async drain() {
    this.running = true;
    try {
      while (this.queue.size) {
        const key = this.queue.keys().next().value;
        try { await this.ensure(key); }
        catch { logSessionFailure(this.api, 'session-title', key, 'storage-or-gateway'); }
        finally { this.queue.delete(key); }
        if (this.queue.size) await this.delay();
      }
    } finally {
      this.running = false;
    }
  }

  async ensure(key) {
    const entry = await this.access.entry(key);
    if (!entry || entry.archivedAt || isInternalSessionKey(key) || isPersona(key)) return;
    const label = typeof entry.label === 'string' ? entry.label : '';
    const record = this.record(key);
    if (record?.source === 'user' || record?.attempts >= MAX_ATTEMPTS) return;
    if (record && record.title && label && record.title !== label && !isBadTitle(label, key, entry.sessionId)) {
      // A native rename from an older client also wins over a stored title.
      this.record(key, {title: label, source: 'user'});
      return;
    }
    if (record?.source === 'system' || record?.source === 'auto') return;
    if (SYSTEM_TITLE(key, label)) { this.record(key, {title: label, source: 'system'}); return; }
    const channel = channelTitle(entry, key);
    if (channel) {
      if (record?.source === 'channel' && record.channelTitle === channel.title && record.title === label) return;
      // A channel's origin label is generated by the runtime. Any other
      // meaningful existing label could have been chosen by the user.
      if (!record && !isBadTitle(label, key, entry.sessionId) && label !== entry.origin?.label && label !== channel.title) {
        this.record(key, {title: label, source: 'user'});
        return;
      }
      const attempts = (record?.attempts || 0) + 1;
      this.record(key, {attempts});
      return this.persistLabel(entry, channel.title, 'channel', {channelTitle: channel.title, attempts: 0});
    }
    const file = await stat(entry.transcript).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (!file?.isFile()) return;
    const stamp = `${entry.sessionId}:${file.size}:${file.mtimeMs}`;
    if (record?.attempts >= MAX_ATTEMPTS || record?.stamp === stamp) return;
    const unknownLabel = !record && !isBadTitle(label, key, entry.sessionId);
    const basis = await readTitleTranscript(entry.transcript, unknownLabel ? label : '');
    // Recheck after streaming so a user rename during the read takes priority.
    const current = this.record(key);
    if (current?.source === 'user' || current?.source === 'system') return;
    if (unknownLabel && !basis.legacy) {
      this.record(key, {title: label, source: 'user'});
      return;
    }
    if (basis.legacy && !record) this.record(key, {title: label, source: 'legacy'});
    if (!basis.sources.length) {
      if (!basis.internal && basis.greetings >= 3 && record?.source !== 'heuristic') {
        return this.persistLabel(entry, '简短闲聊', 'heuristic', {basisHash: fingerprint('greetings'), stamp});
      }
      return;
    }
    const text = clipGraphemes(basis.sources.join('\n'), 1500);
    const context = graphemeCount(text, 19) < 20 ? basis.firstReply : '';
    const basisHash = fingerprint(text);
    const attempts = (record?.attempts || 0) + 1;
    this.record(key, {basisHash, stamp, attempts});
    let title = '';
    try {
      title = validateTitle(await this.assistant.title(text, context), basis.sources);
      if (!title) logSessionFailure(this.api, 'session-title', key, 'invalid-model-title');
    } catch (error) {
      logSessionFailure(this.api, 'session-title', key, error.message === 'title-model-unavailable'
        ? 'model-unavailable' : /超时|timeout/i.test(error.message) ? 'model-timeout'
          : /结果未完成/i.test(error.message) ? 'model-output-truncated' : 'model-request-failed');
    }
    if (title) return this.persistLabel(entry, title, 'auto', {basisHash, stamp, attempts});
    if (record?.source === 'heuristic' && record.basisHash === basisHash) return;
    const fallback = heuristicTitle(basis.sources[0]);
    if (fallback && !isBadTitle(fallback, key, entry.sessionId)) return this.persistLabel(entry, fallback, 'heuristic', {basisHash, stamp, attempts});
  }

  async metadata(keys) {
    const records = readSessionJson(this.file);
    const agents = new Map(), rows = {};
    for (const key of keys) {
      const agentId = agentOf(key);
      if (!agentId || agents.has(agentId)) continue;
      agents.set(agentId, this.access.list(agentId));
    }
    for (let start = 0; start < keys.length; start += 16) {
      await Promise.all(keys.slice(start, start + 16).map(async key => {
        if (!agentOf(key)) return;
        const {entries, dir} = await agents.get(agentOf(key));
        const entry = sessionEntry(entries, dir, key);
        if (!entry) return;
        const channel = channelTitle(entry, key);
        const record = records[key];
        const source = record && record.title === entry.label ? record.source : undefined;
        const facts = isInternalSessionKey(key) ? {internal: true}
          : await this.summary(entry).catch(() => {
            logSessionFailure(this.api, 'session-title', key, 'transcript-read');
            return {};
          });
        rows[key] = {archived: Boolean(entry.archivedAt), internal: facts.internal === true,
          ...(facts.messages ? {hasMessages: true} : {}), channel: channel?.channel,
          channelTitle: channel?.title, source};
      }));
    }
    return {rows, model: TITLE_MODEL};
  }

  async summary(entry) {
    const file = await stat(entry.transcript).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (!file?.isFile()) return {};
    const cached = this.summaryCache.get(entry.transcript);
    // A user message at the beginning remains present while more rows append.
    if (cached && cached.size === file.size && cached.mtime === file.mtimeMs) return cached.facts;
    const facts = await readTitleTranscript(entry.transcript, '', true);
    if (this.summaryCache.size >= 1500) this.summaryCache.delete(this.summaryCache.keys().next().value);
    this.summaryCache.set(entry.transcript, {size: file.size, mtime: file.mtimeMs, facts});
    return facts;
  }
}

export function registerSessionMethod(api, name, fn) {
  api.registerGatewayMethod?.(name, async ({params, respond, context}) => {
    try { respond(true, await fn(params || {}, context)); }
    catch (error) { respond(false, undefined, {code: 'INVALID_REQUEST', message: error.message}); }
  }, {scope: 'operator.admin'});
}

export function sessionTool(name, description, properties, required, run) {
  return {
    name, label: name, description,
    parameters: {type: 'object', additionalProperties: false, properties, required},
    async execute(toolCallId, params = {}) {
      try {
        const details = await run(params, toolCallId);
        return {content: [{type: 'text', text: JSON.stringify(details)}], details};
      } catch (error) {
        return {content: [{type: 'text', text: error.message}], isError: true};
      }
    },
  };
}

const TITLE_INSTANCES = Symbol.for('pinkie.session-titles.v1');
export function registerSessionTitles(api, options) {
  const shared = globalThis[TITLE_INSTANCES] ??= new Map();
  if (!shared.has(options.root)) shared.set(options.root, new SessionTitles(api, {...options, access: createSessionAccess(api, options)}));
  const titles = shared.get(options.root);
  registerSessionMethod(api, 'pinkie.session.title.ensure', ({keys}) => {
    if (!Array.isArray(keys) || keys.length > ENSURE_LIMIT) throw new Error('每批最多 20 条会话');
    return titles.enqueue(keys);
  });
  registerSessionMethod(api, 'pinkie.session.title.metadata', ({keys}) => titles.metadata(
    Array.isArray(keys) ? [...new Set(keys.slice(0, 1000).filter(key => agentOf(key)))] : []));
  registerSessionMethod(api, 'pinkie.session.rename', ({key, title}) => titles.rename(key, title, 'user'));
  api.registerTool?.(ctx => sessionTool('pinkie_session_title',
    '只改当前会话的名字。仅在主题已经明显改变、旧名字会误导用户时使用。用户自己起的名不改。',
    {title: {type: 'string'}}, ['title'], async ({title}) => {
      const record = await titles.rename(ctx.sessionKey, title, 'auto');
      if (!record) throw new Error('会话名称已变更，请保留当前名称');
      return {title: record.title};
    }), {name: 'pinkie_session_title'});
  return titles;
}
