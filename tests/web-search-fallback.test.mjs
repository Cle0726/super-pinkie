import test from 'node:test';
import assert from 'node:assert/strict';
import {createPinkieSearchTool, parseBing, parseDuckDuckGo, searchWeb} from '../services/mode-architecture/web-search-fallback.mjs';

const BING = `<ol id="b_results"><li class="b_algo" data-x="1"><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;u=a1${Buffer.from('https://gxeea.cn/zsb').toString('base64url')}&amp;ntb=1">广西<strong>专升本</strong> &amp; 招生</a></h2><div class="b_caption"><p>2027 年考试安排&nbsp;公告</p></div></li><li class="b_algo"><h2><a href="https://example.com/b">Second</a></h2><p>two</p></li></ol>`;
const DDG = `<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fopenclaw.ai%2Fdocs&amp;rut=x">OpenClaw Docs</a><a class="result__snippet" href="#">The <b>docs</b></a>`;

test('Bing and DuckDuckGo pages parse to clean titles, real URLs and snippets', () => {
  assert.deepEqual(parseBing(BING), [
    {title: '广西专升本 & 招生', url: 'https://gxeea.cn/zsb', snippet: '2027 年考试安排 公告'},
    {title: 'Second', url: 'https://example.com/b', snippet: 'two'},
  ]);
  assert.deepEqual(parseDuckDuckGo(DDG), [{title: 'OpenClaw Docs', url: 'https://openclaw.ai/docs', snippet: 'The docs'}]);
});

test('a blocked or challenged source sends 碧琪 to a real browser search instead of giving up', async () => {
  const ok = await searchWeb('openclaw', {fetchImpl: async () => new Response(DDG)});
  assert.equal(ok.ok, true); assert.equal(ok.source, 'duckduckgo'); assert.equal(ok.results[0].url, 'https://openclaw.ai/docs');
  for (const fetchImpl of [async () => { throw new TypeError('fetch failed'); }, async () => new Response('<form id="challenge-form">'), async () => new Response('x', {status: 403})]) {
    const tool = createPinkieSearchTool({search: q => searchWeb(q, {fetchImpl})});
    const reply = (await tool.execute('t', {query: '广西 专升本'})).details;
    assert.equal(reply.ok, false);
    assert.match(reply.reason, /browser 工具/); assert.match(reply.reason, /cn\.bing\.com\/search\?q=%E5%B9%BF%E8%A5%BF/);
    assert.match(reply.reason, /不要跟用户说搜索用不了/);
  }
});
