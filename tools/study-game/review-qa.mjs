// 验收用：WebKit（最接近 App 的 WKWebView）+ App 真实窗口尺寸 1280×800@2x + 用户真实的多卡布局，截游戏各页。隔离 harness，不碰 18789。
// 用法：NODE_PATH=<App>/runtime/openclaw/node_modules node tools/study-game/review-qa.mjs <views|...> [--engine=webkit] [--layout=triple-chat|single] [--theme=dark]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {harnessWithGame, deskReady, seedMonsters} from './game-qa.mjs';
import {launch, openPage} from './ui-qa.mjs';
import {wkPage} from './wk.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2), cmd = args.find(a => !a.startsWith('--')) || 'views';
const opt = (name, d) => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? d;
const out = path.resolve(opt('out', path.join(repo, '../../briefs/study-desk-game/qa-review/webkit')));
fs.mkdirSync(out, {recursive: true});
const wait = ms => new Promise(r => setTimeout(r, ms));
const W = Number(opt('width', 1280)), H = Number(opt('height', 800));

// 原生 WKWebView 打开隔离 harness（初始化脚本和 ui-qa openPage 一样：特效档位、主题、rAF 计数）。
export async function openWk(harness, {width = W, height = H, theme = 'dark', tier = 'standard', query = '', still = !args.includes('--live')} = {}) {
  const page = await wkPage({width, height, dark: theme === 'dark'});
  await page.addInitScript(([tier, theme]) => {
    try { localStorage.setItem('pinkie.gamefx.v1', JSON.stringify({tier, custom: {}})); } catch {}
    const raw = window.requestAnimationFrame.bind(window); window.__rafCalls = 0;
    window.requestAnimationFrame = cb => { window.__rafCalls++; return raw(cb); };
    window.__qaErrors = []; addEventListener('error', e => window.__qaErrors.push(String(e.message))); addEventListener('unhandledrejection', e => window.__qaErrors.push('rej ' + String(e.reason?.message || e.reason)));
    const paint = () => { const d = document.documentElement; if (!d) return false; d.dataset.themeMode = theme === 'dark' ? 'dark' : 'light'; if (theme === 'dark') d.setAttribute('data-pinkie-night', ''); return true; };
    if (!paint()) document.addEventListener('readystatechange', paint, {once: true});
  }, [tier, theme]);
  // 锁屏时 WebKit 把窗口当 hidden：CSS 动画停在第一帧（opacity 0）。静态版式审查时把动画直接跳到终态。
  if (still) await page.addInitScript(() => { const add = () => { const st = document.createElement('style'); st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}'; document.head.append(st); }; if (document.head) add(); else document.addEventListener('DOMContentLoaded', add, {once: true}); });
  await page.goto(harness.url + query);
  return page;
}

export async function deskLayout(page, layout) {
  if (!layout || layout === 'none') return;
  await page.evaluate(l => window.__pinkieStudyDesk.setLayout(l), layout);
  await wait(800);
}

async function views() {
  const {harness, service, close} = await harnessWithGame();
  seedMonsters(service);
  const list = (opt('views', 'today,gamemap,gameshop,gamegacha,gamewardrobe,gamecodex,gamehunt,gameexam')).split(',');
  try {
    for (const theme of (opt('theme') ? [opt('theme')] : ['dark', 'light'])) {
      const page = await openWk(harness, {theme, tier: opt('tier', 'standard')});
      await deskReady(page, null);
      await deskLayout(page, opt('layout', 'triple-chat'));
      for (const v of list) {
        await page.evaluate(v => window.__pinkieStudyDesk.go(v), v); await wait(Number(opt('settle', 2600)));
        const f = path.join(out, `${opt('tag', 'v')}-${v}-${theme}-${opt('layout', 'triple-chat')}.png`); await page.screenshot({path: f}); console.log(f);
      }
      console.log('errors', JSON.stringify(await page.evaluate(() => window.__qaErrors)));
      await page.close();
    }
  } finally { await close(); }
}
// 作答页（题目在顶层）：讨伐 = 真后端出题 / 判分；守关 = 前端假卷（guard.answer 打桩）；听力 / 长阅读 = 背一背 demo 题。
// 每个主题 × 尺寸截：开局、答错反馈、答对反馈、长阅读题、听力题、守关开局 + 守关反馈。
const READ_Q = 'Read the notice. "Dear residents, from next Monday the community library will move its weekday opening hours. The reading room will open at 8:30 a.m. instead of 9:00 a.m., and it will close at 6 p.m. on Fridays so that staff can prepare the weekend children\'s workshop. Members who want to borrow more than five books at a time should apply at the front desk with their card. Printing is free for students during the exam month, but each person may print no more than twenty pages a day. Please keep the study area quiet and do not reserve seats with bags." According to the notice, the library closes at ___ on Fridays.';
async function drill() {
  const {harness, service, close} = await harnessWithGame({monsters: false});
  const seeds = [
    {key: 'qa-prep', subject: '英语', topic: '介词搭配', question: 'The new policy will have a great impact ___ local business.', answer: 'on', options: ['in', 'at', 'on', 'to']},
    {key: 'qa-trans', subject: '英语翻译', topic: '被动语态', question: '"这座桥建于 1990 年" 最准确的翻译是？', answer: 'The bridge was built in 1990.', options: ['The bridge built in 1990.', 'The bridge was built in 1990.', 'The bridge is building in 1990.', 'The bridge has built in 1990.']},
    {key: 'qa-read', subject: '英语阅读', topic: '细节理解', question: READ_Q, answer: '6 p.m.', options: ['5 p.m.', '6 p.m.', '8:30 a.m.', '9 p.m.']},
  ];
  const sizes = (opt('sizes', '1280x800,1440x900')).split(',').map(x => x.split('x').map(Number));
  const tag = opt('tag', 'q');
  const shot = async (page, name) => { await wait(Number(opt('settle', 700))); const f = path.join(out, `${tag}-${name}.png`); await page.screenshot({path: f}); console.log(f); };
  const fit = page => page.evaluate(() => {
    const col = document.querySelector('.pk-drill-col'); const r = el => el ? Math.round(el.getBoundingClientRect().bottom) : null;
    const opts = [...document.querySelectorAll('.pk-drill-col .pk-choice')]; const sheet = document.querySelector('.pk-drill-col .pk-sheet');
    return {vh: innerHeight, colScroll: col ? col.scrollHeight - col.clientHeight : null, lastOpt: r(opts.at(-1)), sheet: r(sheet), stemTop: Math.round(document.querySelector('.pk-drill-stem')?.getBoundingClientRect().top || 0)};
  });
  const report = {};
  try {
    for (const theme of (opt('theme') ? [opt('theme')] : ['light', 'dark'])) {
      for (const [w, h] of sizes) {
        const key = `${theme}-${w}`; report[key] = {};
        seedMonsters(service, seeds, {level: [2, 4, 3]});
        const page = await openWk(harness, {theme, width: w, height: h});
        await deskReady(page, 'gamehunt');
        await page.locator('.pkb-hunt__go').click();
        await page.locator('.pk-drill-stem').waitFor({timeout: 20000}); await wait(1200);
        await shot(page, `start-${key}`); report[key].start = await fit(page);
        const want = Object.fromEntries(seeds.map(m => [m.question.slice(0, 24), m.answer]));
        for (let k = 0; k < seeds.length + 2; k++) {
          if (!(await page.evaluate(() => !document.querySelector('.pk-done') && [...document.querySelectorAll('.pk-drill-col .pk-choice')].some(e => e.getClientRects().length)))) break;
          const stem = await page.evaluate(() => document.querySelector('.pk-drill-stem')?.textContent || '');
          const long = await page.evaluate(() => Boolean(document.querySelector('.pk-drill-stem.is-long')));
          if (long && !report[key].read) { await shot(page, `read-${key}`); report[key].read = await fit(page); }
          const ans = want[Object.keys(want).find(q => stem.includes(q.slice(0, 18)))];
          const n = await page.locator('.pk-drill-col .pk-choice').count(); let pick = 0;
          const wrong = k === 0;
          for (let i = 0; i < n; i++) { const t = await page.evaluate(i => document.querySelectorAll('.pk-drill-col .pk-choice')[i].querySelector('span').textContent.trim(), i); if ((t === ans) !== wrong) { pick = i; break; } }
          await page.locator('.pk-drill-col .pk-choice', pick).click(); await wait(250);
          try { await page.locator('.pk-drill-check').click(); await page.locator('.pk-drill-col .pk-sheet').waitFor({timeout: 15000}); }
          catch (e) { await shot(page, `FAIL-${key}-${k}`); console.log('state', JSON.stringify(await page.evaluate(() => ({check: document.querySelector('.pk-drill-check')?.outerHTML.slice(0, 200), bar: document.querySelector('.pk-drill-bar')?.hidden, phase: document.querySelector('.pk-drill')?.className})))); throw e; }
          if (k <= 1) { await shot(page, `${wrong ? 'wrong' : 'right'}-${key}`); report[key][wrong ? 'wrong' : 'right'] = await fit(page); }
          if (long && !report[key].readFb) { await shot(page, `readfb-${key}`); report[key].readFb = await fit(page); }
          await page.locator('.pk-drill-col .pk-sheet .pk-btn').click(); await wait(700);
        }
        // 听力（demo 题）
        await page.evaluate(() => { const F = window.__pinkieDrill.fixtures; window.__pinkieDrill.start({demo: true, force: true, items: [structuredClone(F.listen), structuredClone(F.cloze || F.choice)]}); });
        await page.locator('.pk-drill-hear').waitFor({timeout: 10000}).catch(() => {}); await shot(page, `listen-${key}`);
        // 守关（假卷，guard.answer 打桩）
        await page.evaluate(() => {
          const g = window.__pinkieGame; const raw = g.call.bind(g);
          g.call = (name, p, t) => name === 'guard.answer' ? Promise.resolve({correct: p.answer === 1, answer: 1, combo: p.answer === 1 ? 1 : 0, explain: '"if only" 后面接过去完成时，表示对过去的遗憾。'}) : raw(name, p, t);
          const pane = window.__pinkieStudyDesk.pane(); pane.state.guardRoute = {node: {name: '虚拟语气', region: 'grammar'}, payload: {attemptId: 'qa', items: [
            {itemId: 'g1', point: '虚拟语气', prompt: 'If only I ___ harder when I was at school.', options: ['study', 'had studied', 'would study', 'have studied']},
            {itemId: 'g2', point: '非谓语动词', prompt: '___ from the top of the hill, the town looks beautiful.', options: ['Seeing', 'Seen', 'To see', 'Having seen']}]}};
          window.__pinkieStudyDesk.go('gameguard');
        });
        await page.locator('.pkb-guard .pk-choice').waitFor({timeout: 10000}); await wait(900); await shot(page, `guard-${key}`);
        await page.locator('.pkb-guard .pk-choice', 0).click(); await page.locator('.pkb-guard .pk-sheet').waitFor({timeout: 8000}).catch(() => {}); await shot(page, `guardfb-${key}`);
        report[key].errors = await page.evaluate(() => window.__qaErrors);
        await page.close();
      }
    }
  } finally { await close(); }
  fs.writeFileSync(path.join(out, `${tag}-drill.json`), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await ({views, drill}[cmd] || (() => { throw Error('unknown ' + cmd); }))();
