// 页面逻辑验收：每个入口进去 → 做完（或中途退出）→ 记下最后落在哪一页。WebKit + 隔离 harness，不碰 18789。
// 用法：NODE_PATH=<App>/runtime/openclaw/node_modules node tools/study-game/flow-qa.mjs [--only=name,...] [--out=dir]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {harnessWithGame, deskReady, seedMonsters} from './game-qa.mjs';
import {openWk} from './review-qa.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const opt = (name, d) => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? d;
const out = path.resolve(opt('out', path.join(repo, '../../briefs/study-desk-game/qa-review/flows')));
fs.mkdirSync(out, {recursive: true});
const wait = ms => new Promise(r => setTimeout(r, ms));
const only = opt('only', '') ? opt('only').split(',') : null;

const SEEDS = [
  {key: 'f-prep', subject: '英语', topic: '介词搭配', question: 'The new policy will have a great impact ___ local business.', answer: 'on', options: ['in', 'at', 'on', 'to']},
  {key: 'f-tense', subject: '英语', topic: '时态', question: 'By the time we arrived, the film ___.', answer: 'had started', options: ['starts', 'has started', 'had started', 'will start']},
];

const view = page => page.evaluate(() => window.__pinkieStudyDesk?.pane?.()?.view || null);
const buttons = page => page.evaluate(() => [...document.querySelectorAll('#pinkie-study-desk button')].filter(b => !b.closest('nav, .desk-rail, .s-rail, [role=tablist]')).filter(b => b.getClientRects().length).map(b => (b.getAttribute('aria-label') || b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 16)).filter(Boolean));
async function clickText(page, re) {
  return page.evaluate(src => {
    const r = new RegExp(src);
    const b = [...document.querySelectorAll('#pinkie-study-desk button')].find(x => x.getClientRects().length && (r.test((x.getAttribute('aria-label') || '').trim()) || r.test(x.textContent.trim())));
    if (b) { b.click(); return (b.getAttribute('aria-label') || b.textContent).trim().slice(0, 20); }
    return null;
  }, re.source);
}
// 一路选第一个选项答完；遇到填空就随便填一个字
async function answerAll(page, {stopAfter = 99} = {}) {
  for (let k = 0; k < 30 && k < stopAfter; k++) {
    await wait(500);
    const st = await page.evaluate(() => ({done: Boolean(document.querySelector('.pk-done')), choice: [...document.querySelectorAll('.pk-drill-col .pk-choice, .pkb-guard .pk-choice')].some(e => e.getClientRects().length), input: [...document.querySelectorAll('.pk-drill-col input[type=text], .pk-drill-col textarea')].some(e => e.getClientRects().length)}));
    if (process.env.FLOW_DEBUG) console.log('  step', k, JSON.stringify(st), JSON.stringify(await page.evaluate(() => ({check: document.querySelector('.pk-drill-check')?.disabled, sel: document.querySelectorAll('.pk-drill-col .pk-choice[aria-pressed=true], .pk-drill-col .pk-choice.is-picked, .pk-drill-col .pk-choice[aria-checked=true]').length, sheet: Boolean(document.querySelector('.pk-sheet')), sheetBtn: document.querySelector('.pk-drill-col .pk-sheet .pk-btn')?.textContent}))));
    if (st.done || (!st.choice && !st.input)) return k;
    if (st.choice) await page.locator('.pk-drill-col .pk-choice', 1).click();
    else await page.evaluate(() => { const i = [...document.querySelectorAll('.pk-drill-col input[type=text], .pk-drill-col textarea')].find(e => e.getClientRects().length); i.value = 'a'; i.dispatchEvent(new Event('input', {bubbles: true})); });
    await wait(250);
    await page.locator('.pk-drill-check').click().catch(() => {});
    await page.waitForFunction(() => document.querySelector('.pk-sheet') || document.querySelector('.pk-done'), null, {timeout: 15000}).catch(() => {});
    await wait(300);
    await page.locator('.pk-drill-col .pk-sheet .pk-btn').click().catch(() => {}); await wait(500);
  }
  return 30;
}

const FLOWS = {
  // 营地「出发」→ 做完 → 结算页的返回按钮
  async campGo(page) {
    await deskReady(page, 'today');
    await page.evaluate(() => document.querySelector('.pkg-go')?.click()); await wait(2500);
    const started = await view(page);
    await answerAll(page); await wait(1200);
    const done = await buttons(page);
    const clicked = await clickText(page, /^回|返回/); await wait(1500);
    return {started, doneButtons: done.slice(0, 8), clicked, landed: await view(page), expect: 'today'};
  },
  async campGoEscape(page) {
    await deskReady(page, 'today');
    await page.evaluate(() => document.querySelector('.pkg-go')?.click()); await wait(2500);
    const started = await view(page);
    await answerAll(page, {stopAfter: 1});
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))); await wait(800);
    const confirm = await buttons(page);
    await clickText(page, /^(离开|先走|退出|结束|先放着)/); await wait(1200);
    return {started, confirm: confirm.slice(0, 8), landed: await view(page), expect: 'today'};
  },
  async huntDone(page) {
    await deskReady(page, 'gamehunt');
    await page.evaluate(() => document.querySelector('.pkb-hunt__go')?.click()); await wait(2500);
    const started = await view(page);
    await answerAll(page); await wait(1200);
    const done = await buttons(page);
    const clicked = await clickText(page, /^回|返回/); await wait(1500);
    return {started, doneButtons: done.slice(0, 8), clicked, landed: await view(page), expect: 'gamehunt'};
  },
  async huntQuitX(page) {
    await deskReady(page, 'gamehunt');
    await page.evaluate(() => document.querySelector('.pkb-hunt__go')?.click()); await wait(2500);
    await answerAll(page, {stopAfter: 1});
    const x = await clickText(page, /^(关闭|返回|退出|×|离开)/); await wait(800);
    const confirm = await buttons(page);
    await clickText(page, /^(离开|先走|退出|结束|先放着)/); await wait(1200);
    return {x, confirm: confirm.slice(0, 8), landed: await view(page), expect: 'gamehunt'};
  },
  async mapNode(page) {
    await deskReady(page, 'gamemap');
    const r = await page.evaluate(async () => {
      const g = window.__pinkieGame; const w = await g.call('world.get').catch(e => ({err: e.message}));
      const nodes = (w.regions || []).flatMap(x => x.nodes || []);
      const n = nodes.find(x => x.state === 'open' || x.state === 'available' || x.state === 'next') || nodes[0];
      if (!n) return {err: 'no nodes', keys: Object.keys(w || {})};
      const res = await g.startNode(n, 'play');
      return {node: n.id, flow: res?.flow};
    });
    await wait(2500);
    const started = await view(page);
    await answerAll(page); await wait(1200);
    const done = await buttons(page);
    const clicked = await clickText(page, /^回|返回/); await wait(1500);
    return {...r, started, doneButtons: done.slice(0, 8), clicked, landed: await view(page), expect: 'gamemap'};
  },
  async notesDrill(page) {
    await deskReady(page, 'notes');
    const b = await clickText(page, /背一背|开始背|背诵/); await wait(2500);
    const started = await view(page);
    await answerAll(page); await wait(1200);
    const done = await buttons(page);
    const clicked = await clickText(page, /^回|返回/); await wait(1500);
    return {b, started, doneButtons: done.slice(0, 8), clicked, landed: await view(page), expect: 'notes'};
  },
  async vocabDrill(page) {
    await deskReady(page, 'vocab');
    const b = await clickText(page, /背一背|开始背|背诵|练/); await wait(2500);
    const started = await view(page);
    await answerAll(page); await wait(1200);
    const done = await buttons(page);
    const clicked = await clickText(page, /^回|返回/); await wait(1500);
    return {b, started, doneButtons: done.slice(0, 8), clicked, landed: await view(page), expect: 'vocab'};
  },
  // 游戏各页左上角的 × / 返回：从营地进去应回营地；从衣橱点「去商店」再关，应回衣橱
  async gamePagesBack(page) {
    const res = {};
    for (const v of ['gamemap', 'gamehunt', 'gameshop', 'gamegacha', 'gamewardrobe', 'gamecodex', 'gameexam']) {
      await deskReady(page, 'today');
      await page.evaluate(v => window.__pinkieStudyDesk.go(v), v); await wait(1200);
      const x = await clickText(page, /^(回营地|关闭|返回|×)/); await wait(900);
      res[v] = {x, landed: await view(page)};
    }
    await deskReady(page, 'today');
    await page.evaluate(() => window.__pinkieStudyDesk.go('gamewardrobe')); await wait(900);
    await page.evaluate(() => window.__pinkieStudyDesk.go('gameshop')); await wait(1200);
    const mid = await view(page);
    await clickText(page, /^(回营地|关闭|返回|×)/); await wait(900);
    const first = await view(page);
    await clickText(page, /^(回营地|回衣橱|回商店|关闭|返回|×)/); await wait(900);
    res.wardrobeToShopBack = {mid, first, then: await view(page), expect: 'gamewardrobe then today'};
    return res;
  },
};

const {harness, service, close} = await harnessWithGame({monsters: false});
const report = {};
try {
  for (const [name, fn] of Object.entries(FLOWS)) {
    if (only && !only.includes(name)) continue;
    seedMonsters(service, SEEDS, {level: [2, 3]});
    const page = await openWk(harness, {theme: 'light'});
    try { report[name] = await fn(page); }
    catch (e) { report[name] = {error: String(e.message || e).slice(0, 300)}; }
    try { await page.screenshot({path: path.join(out, `${name}.png`)}); } catch { /* ignore */ }
    report[name].errors = await page.evaluate(() => window.__qaErrors || []).catch(() => null);
    console.log(name, JSON.stringify(report[name]));
    await page.close();
  }
} finally { await close(); }
fs.writeFileSync(path.join(out, 'flows.json'), JSON.stringify(report, null, 1));
