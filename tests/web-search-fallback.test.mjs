// A3: pinkie_search tries Bing China → Sogou → 360 → Baidu → DuckDuckGo, skips a source that just failed
// twice, and when every source fails searches in 碧琪's own in-app browser instead of telling the model to.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  SOURCES, SourceHealth, browserResults, createPinkieSearchTool, parse360, parseBaidu, parseBing, parseDuckDuckGo, parseSogou, searchWeb,
} from '../services/mode-architecture/web-search-fallback.mjs';

const fixture = name => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/web-search', name), 'utf8');
const PAGES = {bing: fixture('bing.html'), sogou: fixture('sogou.html'), so360: fixture('so360.html'), baidu: fixture('baidu.html'), duckduckgo: fixture('duckduckgo.html')};
const HOSTS = {'cn.bing.com': 'bing', 'www.sogou.com': 'sogou', 'www.so.com': 'so360', 'www.baidu.com': 'baidu', 'html.duckduckgo.com': 'duckduckgo'};
const NO_BROWSER = {available: () => false, request: async () => { throw new Error('must not be called'); }};

// handlers: {sourceId: (url, init) => Response}; missing ones answer with their saved page.
function fakeFetch(handlers = {}, calls = []) {
  return async (url, init) => {
    const id = HOSTS[new URL(url).hostname];
    calls.push(id);
    return handlers[id] ? handlers[id](url, init) : new Response(PAGES[id]);
  };
}
const broken = () => new Response(fixture('sogou-captcha.html'));
const allBroken = Object.fromEntries(Object.keys(PAGES).map(id => [id, broken]));

test('each source has its own parser that reads its saved page', () => {
  const bing = parseBing(PAGES.bing);
  assert.equal(bing.length, 3);
  assert.deepEqual(bing[0], {title: '广西壮族自治区_百度百科', url: 'https://baike.baidu.com/item/%e5%b9%bf%e8%a5%bf%e5%a3%ae%e6%97%8f%e8%87%aa%e6%b2%bb%e5%8c%ba/163178', snippet: bing[0].snippet});
  assert.match(bing[0].snippet, /^广西壮族自治区（Guangxi/);

  const sogou = parseSogou(PAGES.sogou);
  assert.equal(sogou.length, 3);
  assert.equal(sogou[0].title, '专升本考试--通知公告');
  assert.equal(sogou[0].url, 'http://www.gxeea.cn/zsb/tzgg.htm', 'data-url wins over the /link?url= redirect');
  assert.equal(sogou[1].url, 'https://www.zhihu.com/question/395019398');
  assert.match(sogou[0].snippet, /专升本招生第三次征集计划/);
  assert.ok(sogou.every(r => !r.title.includes('red_beg')), 'comment markers are stripped');

  const so360 = parse360(PAGES.so360);
  assert.equal(so360.length, 2, 'the AI answer card at the top is not a result');
  assert.equal(so360[0].url, 'https://www.eol.cn/baokao/ckdt/2026092016504.html', 'data-mdurl wins over so.com/link');
  assert.equal(so360[1].url, 'https://www.51test.net/zhuanshenben/guangxi/xinwen/');
  assert.match(so360[0].snippet, /^报考专升本的核心前提/);

  const baidu = parseBaidu(PAGES.baidu);
  assert.deepEqual(baidu.map(r => r.url), ['https://www.gxeea.cn/zsb/tzgg.htm', 'https://zs.gxufl.edu.cn/info/103051', 'http://www.baidu.com/link?url=MnOpQr789']);
  assert.equal(baidu[0].title, '专升本考试--通知公告 - 广西招生考试院');
  assert.equal(baidu[0].snippet, '广西2026年普通高等教育专升本招生第三次征集计划 2026-06-01');
  assert.equal(baidu[1].snippet, '自治区教育厅关于印发实施办法的通知');

  const ddg = parseDuckDuckGo(PAGES.duckduckgo);
  assert.equal(ddg.length, 3);
  assert.equal(ddg[0].url, 'https://www.gxeea.cn/zsb/tzgg.htm', 'uddg redirect unwrapped');

  assert.deepEqual(parseSogou(fixture('sogou-captcha.html')), []);
});

test('Bing /ck/a redirect links decode to the real address', () => {
  const html = `<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;u=a1${Buffer.from('https://gxeea.cn/zsb').toString('base64url')}&amp;ntb=1">广西<strong>专升本</strong> &amp; 招生</a></h2><p>考试安排&nbsp;公告</p></li>`;
  assert.deepEqual(parseBing(html), [{title: '广西专升本 & 招生', url: 'https://gxeea.cn/zsb', snippet: '考试安排 公告'}]);
});

test('the chain order is Bing China, Sogou, 360, Baidu, DuckDuckGo', async () => {
  assert.deepEqual(SOURCES.map(s => s.id), ['bing', 'sogou', 'so360', 'baidu', 'duckduckgo']);
  assert.match(SOURCES[0].url('a b'), /^https:\/\/cn\.bing\.com\/search\?q=a%20b/);
  const calls = [];
  const result = await searchWeb('广西 专升本', {fetchImpl: fakeFetch(allBroken, calls), health: new SourceHealth(), browser: NO_BROWSER});
  assert.equal(result.ok, false);
  assert.deepEqual(calls, ['bing', 'sogou', 'so360', 'baidu', 'duckduckgo']);
});

test('A3-2: first source broken → the second answers and every result says where it came from', async () => {
  const calls = [];
  const tool = createPinkieSearchTool({search: (q, opts) => searchWeb(q, {...opts, fetchImpl: fakeFetch({bing: broken}, calls), health: new SourceHealth(), browser: NO_BROWSER})});
  const reply = await tool.execute('t', {query: '广西 专升本'});
  assert.equal(reply.isError, false);
  const value = reply.details;
  assert.equal(value.ok, true);
  assert.equal(value.source, 'sogou');
  assert.equal(value.sourceName, '搜狗');
  assert.ok(value.results.every(r => r.source === 'sogou' && r.title && r.url && typeof r.snippet === 'string'));
  assert.match(value.tried[0], /^必应: 被反机器人验证拦下/);
  assert.deepEqual(calls, ['bing', 'sogou']);
  assert.equal(JSON.parse(reply.content[0].text).results[0].source, 'sogou');
});

test('HTTP errors, network errors, empty pages and timeouts all move on to the next source', async () => {
  const handlers = {
    bing: () => new Response('x', {status: 403}),
    sogou: () => { throw new TypeError('fetch failed', {cause: {code: 'ECONNRESET'}}); },
    so360: () => new Response('<html><body>nothing here</body></html>'),
    baidu: (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))),
  };
  const result = await searchWeb('q', {fetchImpl: fakeFetch(handlers), health: new SourceHealth(), browser: NO_BROWSER, timeoutMs: 50});
  assert.equal(result.source, 'duckduckgo');
  assert.deepEqual(result.tried, ['必应: HTTP 403', '搜狗: ECONNRESET', '360搜索: 没有解析到结果', '百度: 超时']);
});

test('a redirect to a captcha page counts as blocked; cookies set on a redirect are sent on the next hop', async () => {
  const seen = [];
  const handlers = {
    bing: () => new Response(null, {status: 302, headers: {location: 'https://wappass.baidu.com/static/captcha/tuxing.html'}}),
    sogou: () => new Response(null, {status: 302, headers: {location: '/antispider/?from=x'}}),
    so360: (url, init) => {
      seen.push(init.headers.Cookie || '');
      return init.headers.Cookie ? new Response(PAGES.so360) : new Response(null, {status: 302, headers: {location: url, 'set-cookie': 'WZWS4=abc; path=/'}});
    },
  };
  const result = await searchWeb('q', {fetchImpl: fakeFetch(handlers), health: new SourceHealth(), browser: NO_BROWSER});
  assert.equal(result.source, 'so360');
  assert.deepEqual(seen, ['', 'WZWS4=abc']);
  assert.deepEqual(result.tried, ['必应: 被反机器人验证拦下', '搜狗: 被反机器人验证拦下']);
});

test('results are capped at 10 and de-duplicated', async () => {
  const many = '<ol>' + Array.from({length: 14}, (_, i) => `<li class="b_algo"><h2><a href="https://e.com/${i % 12}">T${i}</a></h2><p>s</p></li>`).join('') + '</ol>';
  const result = await searchWeb('q', {fetchImpl: fakeFetch({bing: () => new Response(many)}), health: new SourceHealth(), browser: NO_BROWSER, count: 50});
  assert.equal(result.results.length, 10);
  assert.equal(new Set(result.results.map(r => r.url)).size, 10);
  const few = await searchWeb('q', {fetchImpl: fakeFetch(), health: new SourceHealth(), browser: NO_BROWSER, count: 2});
  assert.equal(few.results.length, 2);
  assert.equal(createPinkieSearchTool().parameters.properties.count.maximum, 10);
});

test('a source failing twice within 60 s is skipped for 10 minutes, then tried again', async () => {
  let now = 1_000_000;
  const health = new SourceHealth({now: () => now});
  const run = async (handlers = {bing: broken}) => { const calls = []; const r = await searchWeb('q', {fetchImpl: fakeFetch(handlers, calls), health, browser: NO_BROWSER}); return {calls, r}; };

  assert.deepEqual((await run()).calls, ['bing', 'sogou']);
  now += 30_000;
  assert.deepEqual((await run()).calls, ['bing', 'sogou'], 'second failure within 60 s');
  now += 1_000;
  const skipped = await run();
  assert.deepEqual(skipped.calls, ['sogou']);
  assert.match(skipped.r.tried[0], /^必应: 最近连续失败，先跳过/);
  now += 9 * 60_000;
  assert.deepEqual((await run()).calls, ['sogou'], 'still inside the 10 minutes');
  now += 60_000;
  assert.deepEqual((await run({})).calls, ['bing'], 'after 10 minutes Bing is tried again and answers');

  // Two failures more than 60 s apart do not trigger the skip.
  const spaced = new SourceHealth({now: () => now});
  spaced.failure('bing'); now += 61_000; spaced.failure('bing');
  assert.equal(spaced.skipped('bing'), false);
  // A success in between resets the count.
  spaced.success('bing'); spaced.failure('bing');
  assert.equal(spaced.skipped('bing'), false);
});

test('when every source is in its skip window they are all tried anyway', async () => {
  const health = new SourceHealth();
  for (const s of SOURCES) { health.failure(s.id); health.failure(s.id); }
  const calls = [];
  const result = await searchWeb('q', {fetchImpl: fakeFetch({}, calls), health, browser: NO_BROWSER});
  assert.equal(result.source, 'bing');
  assert.deepEqual(calls, ['bing']);
});

const SNAPSHOT = {
  title: '广西 专升本 - 搜索',
  text: ['必应', '图片', '视频', '专升本考试--通知公告 - 广西招生考试院', 'gxeea.cn', '广西2026年普通高等教育专升本招生第三次征集计划，6月1日开始填报志愿。',
    '广西普通高等教育专升本考试招生工作实施办法', '自治区教育厅关于印发实施办法的通知，自2025年起执行。', '下一页'].join('\n'),
  elements: [
    {ref: 'p1e1', role: 'link', name: '图片'}, {ref: 'p1e2', role: 'textbox', name: '搜索'},
    {ref: 'p1e7', role: 'link', name: '专升本考试--通知公告 - 广西招生考试院'},
    {ref: 'p1e9', role: 'link', name: '广西普通高等教育专升本考试招生工作实施办法'},
    {ref: 'p1e12', role: 'link', name: 'https://www.gxeea.cn/zsb'},
  ],
};

test('A3-4: every source broken → the tool itself searches in the in-app browser and returns results', async () => {
  const requests = [];
  const browser = {available: () => true, request: async (action, params) => {
    requests.push({action, params});
    return action === 'open' ? {ok: true, result: {page: {url: params.url}}} : {ok: true, result: SNAPSHOT};
  }};
  const tool = createPinkieSearchTool({search: (q, opts) => searchWeb(q, {...opts, fetchImpl: fakeFetch(allBroken), health: new SourceHealth(), browser})});
  const reply = await tool.execute('t', {query: '广西 专升本'});
  const value = reply.details;
  assert.equal(reply.isError, false);
  assert.equal(value.ok, true);
  assert.equal(value.source, 'browser');
  assert.deepEqual(requests.map(r => r.action), ['open', 'snapshot']);
  assert.equal(requests[0].params.url, 'https://cn.bing.com/search?q=%E5%B9%BF%E8%A5%BF%20%E4%B8%93%E5%8D%87%E6%9C%AC');
  assert.deepEqual(value.results.map(r => [r.title, r.ref, r.source]), [
    ['专升本考试--通知公告 - 广西招生考试院', 'p1e7', 'browser'],
    ['广西普通高等教育专升本考试招生工作实施办法', 'p1e9', 'browser'],
  ]);
  assert.match(value.results[0].snippet, /第三次征集计划/);
  assert.equal(value.tried.length, 5);
  // The model must not be sent off to search in a browser by itself.
  assert.doesNotMatch(reply.content[0].text, /browser 工具|改用浏览器|去用浏览器|自己.{0,6}搜|不要跟用户说/);
});

test('the browser page with no readable links still returns its text', () => {
  assert.deepEqual(browserResults({text: 'a\nb', elements: []}), []);
});

test('every source broken and no in-app browser → a plain failure without a browser instruction', async () => {
  const tool = createPinkieSearchTool({search: (q, opts) => searchWeb(q, {...opts, fetchImpl: fakeFetch(allBroken), health: new SourceHealth(), browser: NO_BROWSER})});
  const reply = await tool.execute('t', {query: '广西 专升本'});
  assert.equal(reply.isError, true);
  assert.equal(reply.details.ok, false);
  assert.equal(reply.details.tried.length, 5);
  assert.doesNotMatch(reply.content[0].text, /browser|浏览器/i);
});

test('the in-app browser failing too is reported in the plain failure', async () => {
  const browser = {available: () => true, request: async () => ({ok: false, reason: '窗口没开'})};
  const value = await searchWeb('q', {fetchImpl: fakeFetch(allBroken), health: new SourceHealth(), browser});
  assert.equal(value.ok, false);
  assert.match(value.tried.at(-1), /窗口没开/);
});

test('the default browser hook is off when PINKIE_APP_BROWSER_ENDPOINT is unset', async () => {
  const saved = process.env.PINKIE_APP_BROWSER_ENDPOINT;
  delete process.env.PINKIE_APP_BROWSER_ENDPOINT;
  try {
    const value = await searchWeb('q', {fetchImpl: fakeFetch(allBroken), health: new SourceHealth()});
    assert.equal(value.ok, false);
    assert.doesNotMatch(value.reason, /browser|浏览器/i);
  } finally { if (saved !== undefined) process.env.PINKIE_APP_BROWSER_ENDPOINT = saved; }
});
