// 月度回顾（任务书 任务-官方新功能五项-1125.md 第 2 项）：首页回顾卡和设置卡片。
// 前提：首页是 html[data-laolao-startup-home="1"] 下 .chat-main 里的一列，卡片排在「继续之前的工作」前面；
// 正例：1–7 日出卡，说上个月的会话数、常用模式、项目标题、学习数；数很少给一句；设置里能关、能算上无限制、能随时看；
// 反例：8 日以后不出、关掉不出、收起后这个月不再出、无限制默认不算、离开首页卡片跟着撤；对外请求 0 次；只用 textContent。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const SRC = read('ui/injections/laolao-recap.js');
const CSS = read('ui/injections/laolao-recap.css');

test('接入和健康度：头片段和 regions.json 登记；只用 textContent；不新增观察器 / 定时器 / window 全局；不调模型', () => {
  const head = read('ui/injections/laolao-head.fragment.html');
  assert.match(head, /<link rel="stylesheet" href="\/laolao-recap\.css\?v=@hash">/);
  assert.match(head, /<script defer src="\/laolao-recap\.js\?v=@hash"><\/script>/);
  const home = JSON.parse(read('ui/injections/regions.json')).regions.find((r) => r.id === 'companion-and-home');
  assert.ok(home.files.includes('laolao-recap.js') && home.files.includes('laolao-recap.css'));
  assert.doesNotMatch(SRC, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.doesNotMatch(SRC, /new MutationObserver|setInterval\(|window\.__[a-zA-Z]+\s*=/);
  assert.doesNotMatch(SRC, /chat\.send|sessions\.send|agent\.run|fetch\(|XMLHttpRequest/, '只调 sessions.list 和 pinkie.recap.month');
  assert.doesNotMatch(CSS, /!important/);
  assert.doesNotMatch(SRC + CSS, /Claude|OpenClaw|Artifacts/i, '界面用碧琪自己的叫法');
});

const NOW = Date.now();
const at = (y, m, d) => new Date(y, m - 1, d, 10, 0, 0).getTime();
const SESSIONS = [
  ['agent:main:a', '聊天一', at(2026, 11, 3)], ['agent:main:b', '聊天二', at(2026, 11, 9)], ['agent:main:c', '聊天三', at(2026, 11, 28)],
  ['agent:project:p1', '登录页改蓝色', at(2026, 11, 12)], ['agent:project:p2', '月报脚本', at(2026, 11, 20)],
  ['agent:learning:l1', '专升本数学', at(2026, 11, 15)],
  ['agent:unrestricted:u1', '随便聊', at(2026, 11, 5)], ['agent:unrestricted:u2', '随便聊二', at(2026, 11, 6)],
  ['agent:unrestricted:u3', '随便聊三', at(2026, 11, 7)], ['agent:unrestricted:u4', '随便聊四', at(2026, 11, 8)],
  ['agent:main:old', '十月的', at(2026, 10, 30)], ['agent:main:dec', '十二月的', at(2026, 12, 1)],
  ['agent:main:sub:subagent:x', '子任务', at(2026, 11, 10)],
].map(([key, label, updatedAt]) => ({key, label, updatedAt}));
const STUDY = {month: '2026-11', study: {activeDays: 9, minutes: 320, answered: 140, correct: 112, wrong: 28, reviews: 35, notes: 4, lessons: 3},
  vocab: {added: 40, reviewed: 120}, streak: {current: 5, best: 9}};

async function setup(t) {
  const {playwright} = await import('../tools/study-desk/harness.mjs');
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return null; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  try { return await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return null; }
}

// 假页面：首页那一列 + 「继续之前的工作」+ 设置弹层的滚动区；假网关记下每次调用。
const PAGE = `<!doctype html><html data-laolao-mode="chat" data-laolao-startup-home="1" data-laolao-startup-ready="1"><head><meta charset="utf-8">
<style>:root{--text-strong:#1f1d1a;--muted-strong:#6b675f;--accent:#2f4bb0;--popover:#fffdfd;--metre-surface:#232321;--metre-line-strong:#393835;--metre-muted:#918D84;--metre-text:#ECEAE4;--metre-cobalt:#93A5EE;--laolao-home-col:min(720px,calc(100% - 48px))}
body{background:linear-gradient(90deg,#f0a,#0af)} .chat-main{display:flex;flex-direction:column;height:700px}</style>
<style>${CSS}</style></head><body><div class="chat-main"><section class="laolao-startup-home"></section><section class="laolao-startup-home__recent"><h3>继续之前的工作</h3></section></div>
<div id="laolao-user-settings"><div class="pinkie-user-settings__scroll"><footer class="pinkie-user-settings__footer"></footer></div></div></body></html>`;

async function open(browser, {date, prefs = null, sessions = SESSIONS, study = STUDY}) {
  const tab = await browser.newPage();
  const outside = [];
  await tab.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:30131/')) return route.fulfill({contentType: 'text/html; charset=utf-8', body: PAGE});
    outside.push(url); return route.abort();
  });
  await tab.clock.setFixedTime(date);
  await tab.goto('http://127.0.0.1:30131/chat');
  await tab.evaluate(({prefs, sessions, study}) => {
    localStorage.clear();
    if (prefs) localStorage.setItem('pinkie.recap.prefs', JSON.stringify(prefs));
    window.calls = [];
    window.__laolaoSidebar = {gwRequest: async (method, params) => {
      window.calls.push([method, params]);
      if (method === 'sessions.list') return {sessions};
      if (method === 'pinkie.recap.month') return study;
      throw new Error('unexpected ' + method);
    }};
    window.Pinkie = {domWatch: {poll: (fn) => { window.recapPoll = fn; return () => {}; }}};
  }, {prefs, sessions, study});
  await tab.addScriptTag({content: SRC});
  return {tab, outside};
}
const card = (tab) => tab.locator('.chat-main > .laolao-startup-home__recap');

test('真浏览器：12 月 2 日首页出上个月回顾，排在「继续之前的工作」前面；数对、无限制默认不算、子任务 / 别的月不算；对外 0 次', {timeout: 60_000}, async (t) => {
  const browser = await setup(t); if (!browser) return;
  try {
    const {tab, outside} = await open(browser, {date: new Date(2026, 11, 2, 10, 0, 0)});
    await card(tab).waitFor({timeout: 5000});
    assert.equal(await tab.evaluate(() => document.querySelector('.laolao-startup-home__recap').nextElementSibling.className), 'laolao-startup-home__recent');
    assert.equal(await card(tab).getAttribute('data-month'), '2026-11');
    const text = await card(tab).innerText();
    t.diagnostic(text.replace(/\n/g, ' / '));
    assert.match(text, /11 月回顾/);
    assert.match(text, /一起聊了 6 个会话/, '3 唠嗑 + 2 项目 + 1 学习；无限制 4 个、子任务、十月 / 十二月的都不算');
    assert.match(text, /唠嗑 3 个、项目 2 个/);
    assert.match(text, /「登录页改蓝色」、「月报脚本」/);
    assert.match(text, /学了 320 分钟，做了 140 道题，其中 28 道进了错题，复习 35 次/);
    assert.match(text, /新添 40 个词，背过 120 个/);
    assert.match(text, /连着学了 5 天/);
    assert.doesNotMatch(text, /随便聊|无限制/);
    // 首页背后是插画：卡片底必须不透明（11-25 截图里透明底压在像素舞台 / 气球上读不清）；Metre 用自己的面板色。
    const bg = async () => tab.evaluate(() => getComputedStyle(document.querySelector('.laolao-startup-home__recap')).backgroundColor);
    assert.equal(await bg(), 'rgb(255, 253, 253)', '唠嗑等模式：--popover 实底');
    await tab.evaluate(() => document.documentElement.setAttribute('data-laolao-mode', 'metre'));
    assert.equal(await bg(), 'rgb(35, 35, 33)', 'Metre：--metre-surface 实底');
    await tab.evaluate(() => document.documentElement.setAttribute('data-laolao-mode', 'chat'));
    const calls = await tab.evaluate(() => window.calls.map(([m, p]) => m + ':' + JSON.stringify(p)));
    assert.deepEqual(calls.sort(), ['pinkie.recap.month:{"month":"2026-11"}', 'sessions.list:{"limit":1000}']);
    // 收起：这个月不再出现
    await tab.locator('.laolao-startup-home__recap-close').click();
    assert.equal(await card(tab).count(), 0);
    await tab.evaluate(() => window.recapPoll());
    assert.equal(await card(tab).count(), 0, '收起后同一个月不再出');
    assert.equal(JSON.parse(await tab.evaluate(() => localStorage.getItem('pinkie.recap.prefs'))).dismissed, '2026-11');
    assert.deepEqual(outside, [], '没有任何对外请求');
  } finally { await browser.close(); }
});

test('真浏览器：8 日以后不出；关掉不出；离开首页卡片撤掉；数很少只给一句', {timeout: 60_000}, async (t) => {
  const browser = await setup(t); if (!browser) return;
  try {
    let {tab} = await open(browser, {date: new Date(2026, 11, 8, 10, 0, 0)});
    await tab.waitForTimeout(400);
    assert.equal(await card(tab).count(), 0, '8 日不出');
    assert.equal(await tab.evaluate(() => window.calls.length), 0, '不出就不去取数');
    await tab.close();
    ({tab} = await open(browser, {date: new Date(2026, 11, 1, 9, 0, 0), prefs: {off: true}}));
    await tab.waitForTimeout(400);
    assert.equal(await card(tab).count(), 0, '关掉不出');
    await tab.close();
    ({tab} = await open(browser, {date: new Date(2026, 11, 3, 9, 0, 0)}));
    await card(tab).waitFor({timeout: 5000});
    await tab.evaluate(() => { document.documentElement.removeAttribute('data-laolao-startup-home'); window.recapPoll(); });
    assert.equal(await card(tab).count(), 0, '离开首页就撤');
    await tab.close();
    const thin = {month: '2026-11', study: {activeDays: 0, minutes: 0, answered: 0, correct: 0, wrong: 0, reviews: 0, notes: 0, lessons: 0}, vocab: {added: 0, reviewed: 0}, streak: {current: 0, best: 0}};
    ({tab} = await open(browser, {date: new Date(2026, 11, 2, 9, 0, 0), sessions: SESSIONS.slice(0, 1), study: thin}));
    await card(tab).waitFor({timeout: 5000});
    assert.equal(await card(tab).getAttribute('data-short'), '1');
    assert.equal(await card(tab).locator('.laolao-startup-home__recap-line').count(), 1, '只有一句');
    assert.match(await card(tab).innerText(), /没怎么见面/);
    assert.doesNotMatch(await card(tab).innerText(), /\b0 /, '不硬凑零');
  } finally { await browser.close(); }
});

test('真浏览器：设置卡片——算上无限制后会话数变多；「看上个月」随时出同一张卡；「收起」边框对卡片底 ≥ 3:1、高 ≥ 24', {timeout: 60_000}, async (t) => {
  const browser = await setup(t); if (!browser) return;
  try {
    const {tab} = await open(browser, {date: new Date(2026, 11, 20, 10, 0, 0)});
    const settings = tab.locator('.laolao-recap-settings');
    await settings.waitFor({timeout: 5000});
    assert.equal(await tab.evaluate(() => document.querySelector('.laolao-recap-settings').nextElementSibling?.className), 'pinkie-user-settings__footer');
    const [on, off] = [settings.locator('[aria-labelledby="laolao-recap-unrestricted"] button').first(), settings.locator('[aria-labelledby="laolao-recap-unrestricted"] button').last()];
    assert.equal(await off.getAttribute('aria-pressed'), 'true', '默认不算无限制');
    await settings.locator('.laolao-recap-open').click();
    await settings.locator('.laolao-startup-home__recap').waitFor({timeout: 5000});
    assert.match(await settings.locator('.laolao-startup-home__recap').innerText(), /一起聊了 6 个会话/);
    assert.equal(await settings.locator('.laolao-startup-home__recap-close').count(), 0, '预览里没有「收起」');
    await on.click();
    assert.equal(await on.getAttribute('aria-pressed'), 'true');
    await settings.locator('.laolao-recap-open').click();
    await tab.waitForFunction(() => /一起聊了 10 个会话/.test(document.querySelector('.laolao-recap-preview')?.textContent || ''), null, {timeout: 5000});
    assert.equal(await card(tab).count(), 0, '20 日首页不出卡，设置里照样能看');
    // 「收起」键：真页面计算样式量边框对卡片背后的底（这里是白底）
    await tab.evaluate(() => { localStorage.removeItem('pinkie.recap.prefs'); });
    await tab.clock.setFixedTime(new Date(2026, 11, 2, 10, 0, 0));
    await tab.evaluate(() => window.recapPoll());
    await card(tab).waitFor({timeout: 5000});
    const m = await tab.evaluate(() => {
      const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const lum = (c) => c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
      const x = document.querySelector('.laolao-startup-home__recap-close'), cs = getComputedStyle(x);
      const [a, b] = [lum(rgb(cs.borderTopColor)), lum([255, 255, 255])].sort((p, q) => q - p);
      return {ratio: +((a + 0.05) / (b + 0.05)).toFixed(2), height: x.getBoundingClientRect().height, text: x.textContent};
    });
    t.diagnostic('收起 ' + JSON.stringify(m));
    assert.ok(m.ratio >= 3, `「收起」边框 ${m.ratio}:1`);
    assert.ok(m.height >= 24);
  } finally { await browser.close(); }
});
