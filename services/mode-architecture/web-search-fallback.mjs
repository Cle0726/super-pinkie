// 碧琪自带的免 Key 网页搜索（模型看到的名字是 pinkie_search；OpenClaw 自带的 web_search 在四个模式里关掉了，
// 见 setup.py 的 REPLACED_OPENCLAW_TOOLS）。
// 一条链按顺序试：必应中国版 → 搜狗 → 360 → 百度 → DuckDuckGo。每家单独一个解析函数、8 秒超时；
// 被拦（验证页/HTTP 错误）、没解析到结果、超时都换下一家，全部失败才算失败。
// 同一家 60 秒内连续失败 2 次，后面 10 分钟先跳过它。
// 全部失败时由工具自己用碧琪的应用内浏览器打开必应搜索页取结果；没有应用内浏览器就直接报失败。
import {appBrowserAvailable, requestAppBrowser} from './app-browser.mjs';

export const MAX_RESULTS = 10;
export const SOURCE_TIMEOUT_MS = 8_000;
export const FAILURE_WINDOW_MS = 60_000;
export const SKIP_MS = 10 * 60_000;

const CHALLENGE = /captcha|anti-?spider|安全验证|验证码|unusual traffic|anomaly-modal|challenge-form|wappass\.baidu\.com/i;
const HEADERS = Object.freeze({
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
});

const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', middot: '·'};
export function htmlText(value = '') {
  return String(value)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/?(?:strong|b|em|i|span|mark|a|wbr)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name) => {
      if (name[0] === '#') {
        const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
      }
      return ENTITIES[name.toLowerCase()] ?? all;
    })
    .replace(/\s+/g, ' ').trim();
}

function cleanUrl(raw, base = 'https://www.bing.com') {
  let url = htmlText(raw);
  try {
    const parsed = new URL(url, base);
    // 必应有时给跳转链接 /ck/a?...&u=a1<base64>，DuckDuckGo 给 //duckduckgo.com/l/?uddg=<原址>。
    const bingTarget = parsed.hostname.endsWith('bing.com') && parsed.pathname.startsWith('/ck/') ? parsed.searchParams.get('u') : '';
    if (bingTarget && bingTarget.startsWith('a1')) {
      url = Buffer.from(bingTarget.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    } else if (parsed.hostname.endsWith('duckduckgo.com') && parsed.searchParams.get('uddg')) {
      url = parsed.searchParams.get('uddg');
    } else url = parsed.href;
    const final = new URL(url);
    return ['http:', 'https:'].includes(final.protocol) ? final.href : '';
  } catch { return ''; }
}

const strip = html => String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ');
const item = (title, url, snippet) => ({title, url, snippet: String(snippet || '').slice(0, 400)});

export function parseBing(html = '') {
  const results = [];
  for (const block of strip(html).split(/<li[^>]+class="[^"]*\bb_algo\b[^"]*"/i).slice(1)) {
    const link = /<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!link) continue;
    const url = cleanUrl(link[1]);
    const title = htmlText(link[2]);
    const snippet = htmlText((/<p[^>]*>([\s\S]*?)<\/p>/i.exec(block) || /class="[^"]*b_caption[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block) || [])[1] || '');
    if (url && title) results.push(item(title, url, snippet));
  }
  return results;
}

// 搜狗：每条结果一个 <h3>（vr-title / pt），链接是 /link?url= 跳转；同一块里的 data-url 是真实网址。
export function parseSogou(html = '') {
  const results = [];
  for (const block of strip(html).split(/(?=<h3\b)/i).slice(1)) {
    const link = /^<h3[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!link) continue;
    const title = htmlText(link[2]);
    const real = /\bdata-url="(https?:[^"]+)"/i.exec(block)?.[1];
    const url = cleanUrl(real || link[1], 'https://www.sogou.com');
    const after = block.slice(block.search(/<\/h3>/i) + 5);
    const summary = /class="(?:ft|space-txt|text-layout|star-wiki|str-text-info)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p)>/i.exec(after)?.[1];
    const snippet = htmlText(summary || after.split(/<a[^>]+class="citeLinkClass"/i)[0]).slice(0, 200);
    if (url && title && !/^\?/.test(link[1])) results.push(item(title, url, snippet));
  }
  return results;
}

// 360：<li class="res-list"> 里 <h3 class="res-title"> 的链接，data-mdurl 是真实网址（没有就用 href）。
export function parse360(html = '') {
  const results = [];
  for (const block of strip(html).split(/<li[^>]+class="res-list\b/i).slice(1)) {
    const head = /<h3[^>]+class="[^"]*\bres-title\b[^"]*"[^>]*>([\s\S]*?)<\/h3>/i.exec(block);
    if (!head) continue;
    const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(head[1]);
    if (!anchor) continue;
    const real = /\bdata-mdurl="([^"]+)"/i.exec(anchor[1])?.[1] || /\bhref="([^"]+)"/i.exec(anchor[1])?.[1] || '';
    const url = cleanUrl(real, 'https://www.so.com');
    const title = htmlText(anchor[2]);
    const summary = /data-result-summary[^>]*>([\s\S]*?)<\/span>/i.exec(block)?.[1]
      || /class="[^"]*\bres-desc\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(block)?.[1] || '';
    if (url && title) results.push(item(title, url, htmlText(summary)));
  }
  return results;
}

// 百度：<div class="result c-container" mu="真实网址"> 里 <h3> 的链接（href 是 baidu.com/link 跳转，没有 mu 时用它）。
export function parseBaidu(html = '') {
  const results = [];
  for (const block of strip(html).split(/(?=<div\b[^>]*class="[^"]*\bresult(?:-op)?\s[^"]*\bc-container\b)/i).slice(1)) {
    const open = /^<div\b([^>]*)>/i.exec(block);
    const link = /<h3[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!open || !link) continue;
    const mu = /\bmu="(https?:[^"]+)"/i.exec(open[1])?.[1];
    const url = cleanUrl(mu || link[1], 'https://www.baidu.com');
    const title = htmlText(link[2]);
    const summary = /class="[^"]*\b(?:c-abstract|content-right_[\w-]+|c-span-last)\b[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span)>/i.exec(block)?.[1] || '';
    if (url && title) results.push(item(title, url, htmlText(summary)));
  }
  return results;
}

export function parseDuckDuckGo(html = '') {
  const results = [];
  for (const block of String(html).split(/(?=<a[^>]+class="[^"]*\bresult__a\b)/i).filter(part => /^<a[^>]+class="[^"]*\bresult__a\b/i.test(part))) {
    const link = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!link) continue;
    const url = cleanUrl(link[1]);
    const title = htmlText(link[2]);
    const snippet = htmlText((/class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/i.exec(block) || [])[1] || '');
    if (url && title) results.push(item(title, url, snippet));
  }
  return results;
}

const enc = encodeURIComponent;
export const SOURCES = Object.freeze([
  {id: 'bing', name: '必应', url: q => `https://cn.bing.com/search?q=${enc(q)}`, parse: parseBing},
  {id: 'sogou', name: '搜狗', url: q => `https://www.sogou.com/web?query=${enc(q)}`, parse: parseSogou},
  {id: 'so360', name: '360搜索', url: q => `https://www.so.com/s?q=${enc(q)}`, parse: parse360},
  {id: 'baidu', name: '百度', url: q => `https://www.baidu.com/s?wd=${enc(q)}&ie=utf-8`, parse: parseBaidu},
  {id: 'duckduckgo', name: 'DuckDuckGo', url: q => `https://html.duckduckgo.com/html/?q=${enc(q)}`, parse: parseDuckDuckGo},
].map(Object.freeze));

// 60 秒内连续失败 2 次 → 10 分钟内先跳过；成功一次就清零。
export class SourceHealth {
  constructor({now = () => Date.now(), windowMs = FAILURE_WINDOW_MS, skipMs = SKIP_MS} = {}) {
    Object.assign(this, {now, windowMs, skipMs}); this.failures = new Map(); this.skipUntil = new Map();
  }
  skipped(id) { return (this.skipUntil.get(id) || 0) > this.now(); }
  success(id) { this.failures.delete(id); this.skipUntil.delete(id); }
  failure(id) {
    const now = this.now();
    const recent = (this.failures.get(id) || []).filter(at => now - at < this.windowMs);
    recent.push(now);
    if (recent.length >= 2) { this.skipUntil.set(id, now + this.skipMs); this.failures.delete(id); }
    else this.failures.set(id, recent);
  }
}
const defaultHealth = new SourceHealth();

class SourceFailure extends Error {}

function cookiesFrom(response) {
  const raw = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
  return raw.map(line => String(line).split(';')[0].trim()).filter(pair => pair.includes('='));
}

// 自己跟跳转并带上中途下发的 Cookie（360 第一次请求先发 Cookie 再 302 回同一地址）。
async function fetchPage(url, {fetchImpl, signal}) {
  const jar = new Map();
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const response = await fetchImpl(current, {headers: {...HEADERS, ...(cookie ? {Cookie: cookie} : {})}, redirect: 'manual', signal});
    for (const pair of cookiesFrom(response)) { const at = pair.indexOf('='); jar.set(pair.slice(0, at), pair.slice(at + 1)); }
    const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : '';
    if (location) {
      current = new URL(location, current).href;
      if (CHALLENGE.test(current)) throw new SourceFailure('被反机器人验证拦下');
      continue;
    }
    if (!response.ok) throw new SourceFailure(`HTTP ${response.status}`);
    return {html: await response.text(), url: response.url || current};
  }
  throw new SourceFailure('跳转次数过多');
}

async function trySource(source, q, {fetchImpl, signal, timeoutMs}) {
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    const {html, url} = await fetchPage(source.url(q), {fetchImpl, signal: combined});
    const results = source.parse(html);
    if (!results.length) throw new SourceFailure(CHALLENGE.test(html) || CHALLENGE.test(url) ? '被反机器人验证拦下' : '没有解析到结果');
    return results;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof SourceFailure) throw error;
    if (deadline.aborted || error?.name === 'TimeoutError') throw new SourceFailure('超时');
    throw new SourceFailure(String(error?.cause?.code || error?.message || error));
  }
}

function finalize(results, sourceId, count) {
  const seen = new Set();
  return results.filter(entry => entry.url ? !seen.has(entry.url) && seen.add(entry.url) : true)
    .slice(0, Math.max(1, Math.min(MAX_RESULTS, Number(count) || MAX_RESULTS)))
    .map(entry => ({...entry, source: sourceId}));
}

// 浏览器兜底：打开必应搜索页，读页面文字和链接。应用内浏览器的快照不带链接地址，
// 所以每条给标题、摘要和页面里的 ref（app_browser click 这个 ref 就能打开）。
export function browserResults(snapshot = {}, count = MAX_RESULTS) {
  const lines = String(snapshot.text || '').split('\n').map(line => line.trim()).filter(Boolean);
  const links = (Array.isArray(snapshot.elements) ? snapshot.elements : [])
    .filter(el => el?.role === 'link' && typeof el.name === 'string' && el.name.trim().length >= 6);
  const names = new Set(links.map(el => el.name.trim()));
  const results = [];
  const seen = new Set();
  for (const link of links) {
    const title = link.name.trim();
    if (seen.has(title) || /^https?:\/\//i.test(title)) continue;
    const at = lines.findIndex(line => line === title || line.startsWith(title));
    if (at < 0) continue;
    const snippet = [];
    for (const line of lines.slice(at + 1, at + 6)) {
      if (names.has(line)) break;
      if (line.length > 12) snippet.push(line);
      if (snippet.join(' ').length > 160) break;
    }
    seen.add(title);
    results.push({title, url: '', ref: link.ref, snippet: snippet.join(' ').slice(0, 400), source: 'browser'});
    if (results.length >= count) break;
  }
  return results;
}

export async function searchInAppBrowser(q, {count = MAX_RESULTS, browser = defaultBrowser, signal} = {}) {
  if (!browser.available()) return null;
  const page = `https://cn.bing.com/search?q=${enc(q)}`;
  const opened = await browser.request('open', {url: page}, {signal});
  if (!opened?.ok) throw new Error(String(opened?.reason || '浏览器没有打开搜索页'));
  const snap = await browser.request('snapshot', {compact: false, maxElements: 200, maxChars: 8000}, {signal});
  if (!snap?.ok) throw new Error(String(snap?.reason || '浏览器没有读到搜索页'));
  const snapshot = snap.result && typeof snap.result === 'object' ? snap.result : {};
  const results = browserResults(snapshot, Math.min(MAX_RESULTS, Number(count) || MAX_RESULTS));
  const text = String(snapshot.text || '');
  if (!results.length && text.length < 40) throw new Error('浏览器里的搜索页没有内容');
  return {
    ok: true, source: 'browser', sourceName: '碧琪浏览器（必应）', query: q, page, results,
    ...(results.length ? {} : {pageText: text.slice(0, 3000)}),
    note: '这些结果是在碧琪浏览器里打开的必应搜索页上读到的：要看哪一条，用 app_browser click 它的 ref，再 read 正文。',
  };
}
const defaultBrowser = Object.freeze({available: () => appBrowserAvailable(), request: (action, params, opts) => requestAppBrowser(action, params, opts)});

export async function searchWeb(query, {count = MAX_RESULTS, fetchImpl = globalThis.fetch, timeoutMs = SOURCE_TIMEOUT_MS, signal,
  sources = SOURCES, health = defaultHealth, browser = defaultBrowser} = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('请填写要搜索的内容。');
  const tried = [];
  // 每家都在跳过期里时仍然全试一遍，免得工具 10 分钟内完全不能用。
  const allSkipped = sources.every(source => health.skipped(source.id));
  for (const source of sources) {
    if (!allSkipped && health.skipped(source.id)) { tried.push(`${source.name}: 最近连续失败，先跳过`); continue; }
    try {
      const results = await trySource(source, q, {fetchImpl, signal, timeoutMs});
      health.success(source.id);
      return {ok: true, source: source.id, sourceName: source.name, query: q, results: finalize(results, source.id, count), ...(tried.length ? {tried} : {})};
    } catch (error) {
      if (signal?.aborted) throw error;
      health.failure(source.id);
      tried.push(`${source.name}: ${error.message}`);
    }
  }
  try {
    const viaBrowser = await searchInAppBrowser(q, {count, browser, signal});
    if (viaBrowser) return {...viaBrowser, tried};
  } catch (error) {
    if (signal?.aborted) throw error;
    tried.push(`碧琪浏览器: ${error?.message || error}`);
  }
  return {ok: false, query: q, tried,
    reason: `这次几家搜索都没连上（${tried.join('；')}）。可以换个说法再搜一次；已经知道网站的话，用 web_fetch 直接读。`};
}

export function createPinkieSearchTool({search = searchWeb} = {}) {
  return {
    name: 'pinkie_search',
    label: '网页搜索',
    description: '网页搜索（不用 Key）。依次试必应、搜狗、360、百度、DuckDuckGo，一家被拦自动换下一家，都不行时自己在碧琪浏览器里搜。返回最多 10 条，每条有标题、网址、摘要和来源（source）；要看正文再用 web_fetch 读网址。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {query: {type: 'string', minLength: 1}, count: {type: 'integer', minimum: 1, maximum: MAX_RESULTS}},
      required: ['query'],
    },
    async execute(_toolCallId, params = {}, signal) {
      let value;
      try { value = await search(params.query, {count: params.count, signal}); }
      catch (error) { value = {ok: false, reason: error?.message || '搜索失败'}; }
      return {content: [{type: 'text', text: JSON.stringify(value)}], details: value, isError: value.ok === false};
    },
  };
}
