// 碧琪自带的免 Key 网页搜索。OpenClaw 的 web_search 依赖用户配置的搜索源：Brave/Gemini 要 Key，
// 免 Key 的 DuckDuckGo 接口常被反机器人验证拦下。这里先试 DuckDuckGo 的 HTML 版（国外或开了代理时可用）；
// 必应、搜狗、百度对没有 Cookie 的程序请求会给验证页或不相干的结果（实测 2026-11），所以不直接抓，
// 连不上时把碧琪引到 browser 工具：真浏览器带 Cookie 和脚本，在必应国内版或百度上搜的结果是正常的。

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

export async function searchWeb(query, {count = 8, fetchImpl = globalThis.fetch, timeoutMs = 12_000, signal} = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('请填写要搜索的内容。');
  const tried = [];
  for (const source of SOURCES) {
    const deadline = AbortSignal.timeout(timeoutMs);
    try {
      const response = await fetchImpl(source.url(q), {headers: HEADERS, redirect: 'follow', signal: signal ? AbortSignal.any([signal, deadline]) : deadline});
      if (!response.ok) { tried.push(`${source.id}: HTTP ${response.status}`); continue; }
      const html = await response.text();
      const results = source.parse(html);
      if (!results.length && CHALLENGE.test(html)) { tried.push(`${source.id}: 被反机器人验证拦下`); continue; }
      const seen = new Set();
      const unique = results.filter(item => !seen.has(item.url) && seen.add(item.url)).slice(0, Math.max(1, Math.min(20, count)));
      if (unique.length) return {ok: true, source: source.id, query: q, results: unique};
      tried.push(`${source.id}: 没有解析到结果`);
    } catch (error) {
      if (signal?.aborted) throw error;
      tried.push(`${source.id}: ${error?.name === 'TimeoutError' ? '超时' : String(error?.cause?.code || error?.message || error)}`);
    }
  }
  return {ok: false, query: q, tried,
    reason: `免 Key 搜索源这次没连上（${tried.join('；')}）。接着用 browser 工具搜：open https://cn.bing.com/search?q=${encodeURIComponent(q)}（国内）或 https://www.baidu.com/s?wd=${encodeURIComponent(q)}，再 snapshot 读结果；也可以用 web_fetch 直接读已知网站。不要跟用户说搜索用不了。`,
  };
}

export function createPinkieSearchTool({search = searchWeb} = {}) {
  return {
    name: 'pinkie_search',
    label: '网页搜索',
    description: '碧琪自带的免 Key 网页搜索（DuckDuckGo HTML 版）。web_search 报错、没配 Key、被拦或没结果时改用它；返回标题、网址和摘要，需要正文再用 web_fetch 读网址。它也连不上时会告诉你怎么用 browser 工具在必应或百度上搜。',
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
