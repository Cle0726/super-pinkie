// 碧琪自带的免 Key 网页搜索。OpenClaw 的 web_search 依赖用户配置的搜索源：Brave/Gemini 要 Key，
// 免 Key 的 DuckDuckGo 接口常被反机器人验证拦下，国内不开代理时干脆连不上。
// 两路同时搜，谁先拿到结果用谁：
//   1. DuckDuckGo HTML 版（直接请求，开了代理时一两秒就回来）；
//   2. 本机的 Chrome / Edge / Brave 以无界面模式打开必应国内版，取渲染后的页面解析（国内直连可用，
//      5-10 秒）。真浏览器带 Cookie 和脚本，不像程序直接抓那样被验证页挡住。百度对无界面浏览器
//      也弹「百度安全验证」（实测 2026-11-16），所以只用必应。
// 两路都失败时才把碧琪引到 browser 工具。全程不要 Key、不花钱。
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openclawStateDir} from './openclaw-paths.mjs';

const SOURCES = Object.freeze([
  {id: 'duckduckgo', url: q => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, parse: parseDuckDuckGo},
]);
const CHALLENGE = /captcha|anti-?spider|安全验证|验证码|unusual traffic|anomaly-modal|challenge-form/i;
const HEADERS = Object.freeze({
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
});

const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', middot: '·'};
export function htmlText(value = '') {
  return String(value)
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

function cleanUrl(raw) {
  let url = htmlText(raw);
  try {
    const parsed = new URL(url, 'https://www.bing.com');
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

export function parseBing(html = '') {
  const results = [];
  for (const block of String(html).split(/<li[^>]+class="[^"]*\bb_algo\b[^"]*"/i).slice(1)) {
    const link = /<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!link) continue;
    const url = cleanUrl(link[1]);
    const title = htmlText(link[2]);
    const snippet = htmlText((/<p[^>]*>([\s\S]*?)<\/p>/i.exec(block) || /class="[^"]*b_caption[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block) || [])[1] || '');
    if (url && title) results.push({title, url, snippet: snippet.slice(0, 400)});
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
    if (url && title) results.push({title, url, snippet: snippet.slice(0, 400)});
  }
  return results;
}

const BROWSER_CANDIDATES = Object.freeze({
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
  win32: ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe', 'BraveSoftware/Brave-Browser/Application/brave.exe']
    .flatMap(rel => [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']].filter(Boolean).map(root => path.join(root, rel))),
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/microsoft-edge', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
});
export function findSearchBrowser({env = process.env, platform = process.platform, exists = fs.existsSync} = {}) {
  const explicit = String(env.PINKIE_SEARCH_BROWSER || '').trim();
  if (explicit) return exists(explicit) ? explicit : '';
  return (BROWSER_CANDIDATES[platform] || []).find(file => exists(file)) || '';
}

// One profile directory keeps Bing's cookies between searches; Chrome locks it,
// so searches in this process take turns instead of fighting over the lock.
let browserQueue = Promise.resolve();
export function headlessPage(url, {binary = findSearchBrowser(), profile = path.join(openclawStateDir(), 'pinkie-search-browser'),
  timeoutMs = 25_000, signal, run = execFile} = {}) {
  if (!binary) return Promise.reject(Object.assign(new Error('本机没有 Chrome / Edge / Brave'), {code: 'NO_BROWSER'}));
  const task = browserQueue.then(() => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason || new Error('aborted')); return; }
    try { fs.mkdirSync(profile, {recursive: true, mode: 0o700}); } catch {}
    const child = run(binary, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--mute-audio', `--user-data-dir=${profile}`, '--lang=zh-CN',
      // Bing sometimes fills the result list from script after the first paint;
      // let the page's own timers run before the DOM is dumped.
      '--virtual-time-budget=3000', '--dump-dom', url],
    {timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true, encoding: 'utf8'}, (error, stdout) => {
      signal?.removeEventListener?.('abort', stop);
      if (stdout && String(stdout).length > 200) resolve(String(stdout));
      else reject(error?.killed ? Object.assign(new Error('超时'), {name: 'TimeoutError'}) : (error || new Error('浏览器没有返回页面')));
    });
    const stop = () => { try { child?.kill?.(); } catch {} };
    signal?.addEventListener?.('abort', stop, {once: true});
  }));
  browserQueue = task.catch(() => {});
  return task;
}

const bingUrl = q => `https://cn.bing.com/search?q=${encodeURIComponent(q)}`;
const tidy = (results, count) => {
  const seen = new Set();
  return results.filter(item => !seen.has(item.url) && seen.add(item.url)).slice(0, Math.max(1, Math.min(20, count)));
};
const failure = (id, error) => `${id}: ${error?.name === 'TimeoutError' ? '超时' : String(error?.cause?.code || error?.message || error)}`;

async function viaFetch(source, q, {count, fetchImpl, timeoutMs, signal}) {
  const deadline = AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(source.url(q), {headers: HEADERS, redirect: 'follow', signal: signal ? AbortSignal.any([signal, deadline]) : deadline});
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const results = tidy(source.parse(html), count);
  if (results.length) return results;
  throw new Error(CHALLENGE.test(html) ? '被反机器人验证拦下' : '没有解析到结果');
}

async function viaBrowser(q, {count, browser, signal}) {
  // The very first launch of a fresh profile sometimes returns Bing's bare
  // shell page; one more try with the now-initialised profile gets results.
  let last = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const html = await browser(bingUrl(q), {signal});
    const results = tidy(parseBing(html), count);
    if (results.length) return results;
    last = CHALLENGE.test(html) ? '被反机器人验证拦下' : '没有解析到结果';
    if (last !== '没有解析到结果') break;
  }
  throw new Error(last);
}

export async function searchWeb(query, {count = 8, fetchImpl = globalThis.fetch, timeoutMs = 12_000, signal, browser = headlessPage} = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('请填写要搜索的内容。');
  const tried = [];
  const attempts = SOURCES.map(source => viaFetch(source, q, {count, fetchImpl, timeoutMs, signal})
    .then(results => ({source: source.id, results}), error => { tried.push(failure(source.id, error)); throw error; }));
  // Once one source has answered, the headless browser has nothing left to do.
  const browserStop = new AbortController();
  const browserSignal = signal ? AbortSignal.any([signal, browserStop.signal]) : browserStop.signal;
  if (browser) attempts.push(viaBrowser(q, {count, browser, signal: browserSignal})
    .then(results => ({source: 'bing-browser', results}), error => { tried.push(failure('必应（本机浏览器）', error)); throw error; }));
  try {
    const won = await Promise.any(attempts);
    browserStop.abort();
    return {ok: true, source: won.source, query: q, results: won.results};
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
  }
  return {ok: false, query: q, tried,
    reason: `免 Key 搜索源这次没连上（${tried.join('；')}）。接着用 browser 工具搜：open ${bingUrl(q)}（国内）或 https://www.baidu.com/s?wd=${encodeURIComponent(q)}，再 snapshot 读结果；也可以用 web_fetch 直接读已知网站。不要跟用户说搜索用不了。`,
  };
}

export function createPinkieSearchTool({search = searchWeb} = {}) {
  return {
    name: 'pinkie_search',
    label: '网页搜索',
    description: '碧琪自带的免 Key 网页搜索：同时查 DuckDuckGo 和必应国内版（用本机浏览器在后台打开，国内不开代理也能用），谁先出结果用谁。web_search 报错、没配 Key、被拦或没结果时改用它；返回标题、网址和摘要，需要正文再用 web_fetch 读网址。两路都失败时会告诉你怎么用 browser 工具搜。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {query: {type: 'string', minLength: 1}, count: {type: 'integer', minimum: 1, maximum: 20}},
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
