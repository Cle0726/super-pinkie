// 页面逻辑验收：每个入口进去 → 做完（或中途退出）→ 记下最后落在哪一页。WebKit + 隔离 harness，不碰 18789。
// 用法：NODE_PATH=<App>/runtime/openclaw/node_modules node tools/study-game/flow-qa.mjs [--only=name,...] [--out=dir]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {harnessWithGame, deskReady, seedMonsters, seedPaper, seedBank} from './game-qa.mjs';
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
// 一路答完：选择题挑种子里的正确答案（不认识的题按轮次换选项，避免永远答错被重新排队）；
// 填空随便填一个字；要自己判的点「我对了」；拼词/连线按顺序点。返回走了几步。
const ANSWERS = new Set(SEEDS.map(s => s.answer.toLowerCase()));
async function answerAll(page, {stopAfter = 99, wrongFirst = false} = {}) {
  let tries = 0;
  for (let k = 0; k < 40 && k < stopAfter; k++) {
    await page.waitForFunction(() => document.querySelector('.pk-done') || [...document.querySelectorAll('.pk-drill-col .pk-choice:not([disabled]), .pk-drill-col input[type=text], .pk-drill-col textarea, .pk-rate button')].some(e => e.getClientRects().length), null, {timeout: 12000}).catch(() => {});
    await wait(300);
    const st = await page.evaluate(() => {
      const vis = s => [...document.querySelectorAll(s)].filter(e => e.getClientRects().length);
      return {done: Boolean(document.querySelector('.pk-done')), choices: vis('.pk-drill-col .pk-drill-options .pk-choice:not([disabled])').map(e => e.querySelector('span')?.textContent.trim() || e.textContent.trim()), other: vis('.pk-drill-col .pk-choice:not([disabled])').length, input: vis('.pk-drill-col input[type=text], .pk-drill-col textarea').length, rate: vis('.pk-rate button').length};
    });
    if (process.env.FLOW_DEBUG) console.log('  step', k, JSON.stringify(st));
    if (st.done || (!st.other && !st.input && !st.rate)) return k;
    if (st.rate) { await page.evaluate(() => [...document.querySelectorAll('.pk-rate button')].find(b => /对了/.test(b.textContent))?.click()); }
    else {
      if (st.choices.length) {
        let i = st.choices.findIndex(t => ANSWERS.has(t.toLowerCase()));
        if (i < 0 || (wrongFirst && k === 0)) i = (wrongFirst && k === 0) ? (i + 1) % st.choices.length : tries++ % st.choices.length;
        await page.evaluate(i => [...document.querySelectorAll('.pk-drill-col .pk-drill-options .pk-choice:not([disabled])')].filter(e => e.getClientRects().length)[i].click(), i);
      } else if (st.other) {
        // 拼词 / 连线：把能点的都按顺序点一遍
        for (let j = 0; j < 12; j++) { const ok = await page.evaluate(() => { const b = [...document.querySelectorAll('.pk-drill-col .pk-choice:not([disabled])')].find(e => e.getClientRects().length); if (!b) return false; b.click(); return true; }); if (!ok) break; await wait(120); }
      } else await page.evaluate(() => { const i = [...document.querySelectorAll('.pk-drill-col input[type=text], .pk-drill-col textarea')].find(e => e.getClientRects().length); i.value = 'a'; i.dispatchEvent(new Event('input', {bubbles: true})); });
      await wait(250);
      await page.evaluate(() => { const c = document.querySelector('.pk-drill-check'); if (c && !c.hidden) c.click(); });
    }
    await page.waitForFunction(() => [...document.querySelectorAll('.pk-sheet .pk-btn, .pk-rate button')].some(e => e.getClientRects().length) || document.querySelector('.pk-done'), null, {timeout: 30000}).catch(() => {});
    await wait(300);
    await page.evaluate(() => [...document.querySelectorAll('.pk-drill-col .pk-sheet .pk-btn')].find(e => e.getClientRects().length)?.click()); await wait(600);
  }
  return 40;
}

const shotAt = (page, name) => page.screenshot({path: path.join(out, `${name}.png`)}).catch(() => {});
const esc = page => page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true})));
// 点「先放着」：在打开的确认框里找
const confirmLeave = page => page.evaluate(() => { const d = [...document.querySelectorAll('dialog[open]')].at(-1); const b = d && [...d.querySelectorAll('button')].find(x => /^先放着|离开/.test(x.textContent.trim())); if (b) { b.click(); return b.textContent.trim(); } return null; });
const xLabel = page => page.evaluate(() => { const x = [...document.querySelectorAll('#pinkie-study-desk .pkb-x, #pinkie-study-desk .pk-drill-exit, #pinkie-study-desk .s-top .back')].find(e => e.getClientRects().length && !e.closest('.pkw-card')); return x ? (x.getAttribute('aria-label') || x.textContent).trim() : null; });
const clickX = page => page.evaluate(() => { const x = [...document.querySelectorAll('#pinkie-study-desk .pkb-x, #pinkie-study-desk .pk-drill-exit, #pinkie-study-desk .s-top .back')].find(e => e.getClientRects().length && !e.closest('.pkw-card')); if (x) { x.click(); return (x.getAttribute('aria-label') || x.textContent).trim(); } return null; });
// 结算页：可见的按钮文字（排除顶栏、侧栏）
const doneButtons = page => page.evaluate(() => [...document.querySelectorAll('#pinkie-study-desk .pk-done button, #pinkie-study-desk .pkb-result button, #pinkie-study-desk .sum-act button, #pinkie-study-desk .lesson-actions button, #pinkie-study-desk .pk-drill-empty button, #pinkie-study-desk .pkb-empty button, #pinkie-study-desk .lesson-paper > button')].filter(b => b.getClientRects().length).map(b => (b.getAttribute('aria-label') || b.textContent).trim().replace(/\s+/g, ' ').slice(0, 20)));
async function node(page, kind) {
  return page.evaluate(async kind => {
    const g = window.__pinkieGame; const w = await g.call('world', {exam: 'pretco-b'});
    const nodes = (w.regions || []).flatMap(x => x.nodes || []);
    return nodes.find(n => kind === 'guard' ? n.kind === 'guard' : n.kind !== 'guard') || null;
  }, kind);
}
const startNode = (page, n, mode) => page.evaluate(async ([n, mode]) => { const r = await window.__pinkieGame.startNode(n, mode); return r?.flow || null; }, [n, mode]);
async function finishAndBack(page, name, {answer = true} = {}) {
  if (answer) await answerAll(page);
  await wait(1500); await shotAt(page, name + '-done');
  const done = await doneButtons(page);
  return {done};
}
// 守关卷要内置模型出题；隔离数据里换成一份固定的 12 题卷（只给守关用，别的模型调用照旧离线）。
function stubGuardModel(service) {
  const game = service.store.game, prev = game.requestModel;
  const items = Array.from({length: 12}, (_, i) => ({stem: `Guard ${i + 1}: She ___ to work every day.`, options: [`goes ${i}`, `go ${i}`, `went ${i}`, `going ${i}`], answer: 0, point: '一般现在时'}));
  game.requestModel = async (rules, payload) => (payload?.region ? {value: {items}} : prev ? prev(rules, payload) : {unavailable: true});
}
// 守关：一路点第一个选项、继续，直到结算
async function playGuard(page) {
  for (let k = 0; k < 60; k++) {
    await wait(500);
    const st = await page.evaluate(() => ({opt: [...document.querySelectorAll('.pkb-guard .pkb-opt:not([disabled])')].some(e => e.getClientRects().length), result: Boolean(document.querySelector('.pkb-result')), next: [...document.querySelectorAll('.pkb-guard .pk-sheet .pk-btn, .pkb-guard__explain .pk-btn')].some(e => e.getClientRects().length)}));
    if (st.result) return k;
    if (st.next) { await page.evaluate(() => [...document.querySelectorAll('.pkb-guard .pk-sheet .pk-btn, .pkb-guard__explain .pk-btn')].find(e => e.getClientRects().length).click()); continue; }
    if (st.opt) await page.evaluate(() => { document.querySelector('.pkb-guard .pkb-opt:not([disabled])').click(); document.querySelector('.pkb-guard .pk-drill-check.is-ready')?.click(); });
    else if (k > 6) return -1;
  }
  return -2;
}

// 刷题作答页：选择题点第一个、填空填 a、配对点第一个、作文写一句，下一题，直到结算（stopAfter 题后停）
async function playPractice(page, {stopAfter = 99} = {}) {
  for (let k = 0, done = 0; k < 80; k++) {
    await wait(400);
    const st = await page.evaluate(() => {
      const vis = s => [...document.querySelectorAll(s)].filter(e => e.getClientRects().length);
      return {result: Boolean(document.querySelector('.pkp-set .pkb-result')), next: vis('.pkp-fb .pk-btn').length, opt: vis('.pkp-set .pkb-opt:not(:disabled), .pkp-set .pkp-letter:not(:disabled)').length, input: vis('.pkp-set .pkp-input:not(:disabled)').length, essay: vis('.pkp-set .pkp-essay:not(:disabled)').length};
    });
    if (st.result) return done;
    if (st.next) { if (done >= stopAfter) return done; await page.evaluate(() => [...document.querySelectorAll('.pkp-fb .pk-btn')].find(e => e.getClientRects().length).click()); continue; }
    if (st.opt) { await page.evaluate(() => { const b = [...document.querySelectorAll('.pkp-set .pkb-opt:not(:disabled), .pkp-set .pkp-letter:not(:disabled)')].find(e => e.getClientRects().length); b?.click(); document.querySelector('.pkp-set .pk-drill-check.is-ready')?.click(); }); done++; }
    else if (st.input) { await page.evaluate(() => { const i = document.querySelector('.pkp-set .pkp-input'); i.value = 'a'; i.closest('form').requestSubmit(); }); done++; }
    else if (st.essay) { await page.evaluate(() => { const t = document.querySelector('.pkp-set .pkp-essay'); t.value = 'Dear Sir, thank you.'; [...document.querySelectorAll('.pkp-set .pkg-btn')].find(b => /阅卷/.test(b.textContent)).click(); }); done++; }
    await page.waitForFunction(() => document.querySelector('.pkp-fb') || document.querySelector('.pkp-set .pkb-result'), null, {timeout: 30000}).catch(() => {});
  }
  return -1;
}
async function openPracticeFromCamp(page) {
  await deskReady(page, 'today');
  await page.evaluate(() => document.querySelector('.pkg-entry[data-entry="practice"]')?.click()); await wait(1800);
  await page.waitForFunction(() => document.querySelector('.pkp-quick, .pkp-empty'), null, {timeout: 15000}).catch(() => {});
}

const FLOWS = {
  // 刷题：营地入口 → 题库 → 随机 10 题 → 做完 → 结算「回题库」→ × 回营地
  async practiceRandom(page) {
    await openPracticeFromCamp(page);
    const home = await view(page);
    await page.evaluate(() => document.querySelector('.pkp-qcard[data-q="random"]')?.click()); await wait(1800);
    const started = await view(page), x = await xLabel(page);
    const n = await playPractice(page);
    await wait(1200); await shotAt(page, 'practiceRandom-done');
    const done = await doneButtons(page);
    const clicked = await clickText(page, /^回题库$/); await wait(1500);
    const back = await view(page);
    const x2 = await clickX(page); await wait(1200);
    return {home, started, x, n, done, clicked, back, x2, landed: await view(page), expect: 'today'};
  },
  // 刷题：按考点开一组 → 做 2 题 → × → 「先放着，回题库」
  async practiceQuit(page) {
    await openPracticeFromCamp(page);
    await page.evaluate(() => document.querySelector('.pkp-prow:not(.is-head)')?.click()); await wait(1800);
    const started = await view(page);
    await playPractice(page, {stopAfter: 2});
    await clickX(page); await wait(600);
    const left = await confirmLeave(page); await wait(1500);
    return {started, left, landed: await view(page), expect: 'gamepractice'};
  },
  // 刷题：按题型（阅读一篇一组）→ 中途 Escape → 先放着 → 回题库
  async practiceReading(page) {
    await openPracticeFromCamp(page);
    await page.evaluate(() => document.querySelector('.pkp-kind[data-kind="rd"]')?.click()); await wait(2000);
    const split = await page.evaluate(() => Boolean(document.querySelector('.pkp-split .pkp-material')));
    await playPractice(page, {stopAfter: 1}); await wait(600); await shotAt(page, 'practiceReading-feedback');
    await esc(page); await wait(600);
    const left = await confirmLeave(page); await wait(1500);
    return {split, left, landed: await view(page), expect: 'gamepractice'};
  },
  // 营地「今日」第二行「练 · 真题」→ 做完 → 结算主按钮回营地
  async practiceToday(page) {
    await deskReady(page, 'today');
    await page.waitForFunction(() => document.querySelector('.pkg-trow[data-step="real"]'), null, {timeout: 15000}).catch(() => {});
    await page.evaluate(() => document.querySelector('.pkg-trow[data-step="real"]')?.click()); await wait(2200);
    const started = await view(page), x = await xLabel(page);
    await playPractice(page); await wait(1200);
    const done = await doneButtons(page);
    const clicked = await clickText(page, /^回营地$/); await wait(1500);
    const rowDone = await page.evaluate(() => document.querySelector('.pkg-trow[data-step="real"]')?.dataset.done || null);
    return {started, x, done, clicked, rowDone, landed: await view(page), expect: 'today'};
  },
  // 刷题：听力 Part I（原录音条）→ × 回题库
  async practiceListening(page) {
    await openPracticeFromCamp(page);
    await page.evaluate(() => document.querySelector('.pkp-qcard[data-q="listening"]')?.click()); await wait(2200);
    const audio = await page.evaluate(() => Boolean(document.querySelector('.pkp-record')));
    await shotAt(page, 'practiceListening');
    await clickX(page); await wait(1200);
    return {audio, landed: await view(page), expect: 'gamepractice'};
  },
  // 营地「出发」（隔离数据里第一个节点在迷雾里 → 上课）→ 结算 / 返回
  async campGo(page) {
    await deskReady(page, 'today');
    const mode = await page.evaluate(() => document.querySelector('.pkg-go')?.dataset.mode || null);
    await page.evaluate(() => document.querySelector('.pkg-go')?.click()); await wait(2500);
    const started = await view(page), x = await xLabel(page);
    await shotAt(page, 'campGo-started');
    const btns = await doneButtons(page);
    const clicked = await clickX(page); await wait(1500);
    return {mode, started, x, btns, clicked, landed: await view(page), expect: 'today'};
  },
  // 营地「出发」碰到「背」节点（先把第一个节点点亮成已探索）→ 背一背 → 做完 → 回营地
  async campGoDrill(page) {
    await deskReady(page, 'today');
    const n = await node(page, 'lesson');
    const flow = await startNode(page, n, 'drill'); await wait(2500);
    const started = await view(page), x = await xLabel(page);
    const {done} = await finishAndBack(page, 'campGoDrill');
    const clicked = await clickText(page, /^回|^先放着/); await wait(1500);
    return {node: n?.id, flow, started, x, done, clicked, landed: await view(page), expect: 'today'};
  },
  async campGuard(page, {service}) {
    stubGuardModel(service);
    await deskReady(page, 'today');
    const n = await node(page, 'guard');
    const flow = await startNode(page, n, 'guard'); await wait(2500);
    const started = await view(page), x = await xLabel(page);
    const steps = await playGuard(page); await wait(1200); await shotAt(page, 'campGuard-done');
    const done = await doneButtons(page);
    const clicked = await clickText(page, /^回/); await wait(1500);
    return {node: n?.id, flow, started, x, steps, done, clicked, landed: await view(page), expect: 'today'};
  },
  async campGoEscape(page) {
    await deskReady(page, 'today');
    const n = await node(page, 'lesson');
    await startNode(page, n, 'drill'); await wait(2500);
    const started = await view(page);
    await answerAll(page, {stopAfter: 1});
    await esc(page); await wait(800);
    const dialog = await page.evaluate(() => [...document.querySelectorAll('dialog[open] button')].map(b => b.textContent.trim()));
    const clicked = await confirmLeave(page); await wait(1200);
    return {started, dialog, clicked, landed: await view(page), expect: 'today'};
  },
  // 营地右栏「今日」各行：背单词 / 笔记回顾 / 错题复测 → 每页左上角返回
  async campRows(page) {
    const res = {};
    for (const re of ['背单词', '笔记回顾', '错题复测']) {
      await deskReady(page, 'today');
      const hit = await page.evaluate(src => { const r = [...document.querySelectorAll('#pinkie-study-desk button, #pinkie-study-desk [role=button]')].find(b => b.getClientRects().length && b.textContent.includes(src)); if (r) { r.click(); return r.textContent.trim().slice(0, 30); } return null; }, re); await wait(2200);
      const v = await view(page), x = await xLabel(page);
      const btns = await doneButtons(page);
      const back = await page.evaluate(() => { const b = [...document.querySelectorAll('#pinkie-study-desk .s-top .back, #pinkie-study-desk .pkb-x, #pinkie-study-desk .pk-drill-exit')].find(e => e.getClientRects().length); if (b) { b.click(); return b.getAttribute('aria-label'); } return null; }); await wait(1000);
      await confirmLeave(page); await wait(800);
      res[re] = {hit, view: v, x, btns, back, landed: await view(page)};
    }
    return res;
  },
  async huntDone(page) {
    await deskReady(page, 'gamehunt');
    await page.evaluate(() => document.querySelector('.pkb-hunt__go')?.click()); await wait(2500);
    const started = await view(page), x = await xLabel(page);
    const {done} = await finishAndBack(page, 'huntDone');
    const clicked = await clickText(page, /^回讨伐/); await wait(1500);
    return {started, x, done, clicked, landed: await view(page), expect: 'gamehunt'};
  },
  // 地图 → 讨伐 → 打完 → 回讨伐 → × 应该回地图（不是营地）
  async mapHuntBack(page) {
    await deskReady(page, 'today');
    await page.evaluate(() => window.__pinkieStudyDesk.go('gamemap')); await wait(1200);
    await page.evaluate(() => window.__pinkieStudyDesk.go('gamehunt')); await wait(1500);
    await page.evaluate(() => document.querySelector('.pkb-hunt__go')?.click()); await wait(2500);
    await answerAll(page); await wait(1200);
    await clickText(page, /^回讨伐/); await wait(1500);
    const at = await view(page), x = await xLabel(page);
    await clickX(page); await wait(1200);
    return {at, x, landed: await view(page), expect: 'gamemap'};
  },
  async huntQuitX(page) {
    await deskReady(page, 'gamehunt');
    await page.evaluate(() => document.querySelector('.pkb-hunt__go')?.click()); await wait(2500);
    await answerAll(page, {stopAfter: 1});
    const x = await clickX(page); await wait(800);
    const dialog = await page.evaluate(() => [...document.querySelectorAll('dialog[open] button')].map(b => b.textContent.trim()));
    const clicked = await confirmLeave(page); await wait(1200);
    return {x, dialog, clicked, landed: await view(page), expect: 'gamehunt'};
  },
  // 地图节点：学 / 背 / 守关，各自做完或退出都回地图
  async mapLearn(page) {
    await deskReady(page, 'gamemap');
    const n = await node(page, 'lesson');
    const flow = await startNode(page, n, 'learn'); await wait(3000);
    const started = await view(page), x = await xLabel(page);
    await shotAt(page, 'mapLearn-started');
    const btns = await doneButtons(page);
    const clicked = await clickX(page); await wait(1500);
    return {node: n?.id, flow, started, x, btns, clicked, landed: await view(page), expect: 'gamemap'};
  },
  async mapDrill(page) {
    await deskReady(page, 'gamemap');
    const n = await node(page, 'lesson');
    const flow = await startNode(page, n, 'drill'); await wait(2500);
    const started = await view(page), x = await xLabel(page);
    const {done} = await finishAndBack(page, 'mapDrill');
    const clicked = await clickText(page, /^回地图/); await wait(1500);
    return {node: n?.id, flow, started, x, done, clicked, landed: await view(page), expect: 'gamemap'};
  },
  async mapDrillQuit(page) {
    await deskReady(page, 'gamemap');
    const n = await node(page, 'lesson');
    await startNode(page, n, 'drill'); await wait(2500);
    await answerAll(page, {stopAfter: 1});
    const x = await clickX(page); await wait(800);
    const dialog = await page.evaluate(() => [...document.querySelectorAll('dialog[open] button')].map(b => b.textContent.trim()));
    const clicked = await confirmLeave(page); await wait(1200);
    return {x, dialog, clicked, landed: await view(page), expect: 'gamemap'};
  },
  async mapGuard(page, {service}) {
    stubGuardModel(service);
    await deskReady(page, 'gamemap');
    const n = await node(page, 'guard');
    const flow = await startNode(page, n, 'guard'); await wait(2500);
    const started = await view(page), x = await xLabel(page);
    const steps = await playGuard(page); await wait(1200); await shotAt(page, 'mapGuard-done');
    const done = await doneButtons(page);
    const clicked = await clickText(page, /^回地图/); await wait(1500);
    return {node: n?.id, flow, started, x, steps, done, clicked, landed: await view(page), expect: 'gamemap'};
  },
  async mapGuardQuit(page, {service}) {
    stubGuardModel(service);
    await deskReady(page, 'gamemap');
    const n = await node(page, 'guard');
    await startNode(page, n, 'guard'); await wait(2500);
    // 先答两题，再按 Escape：应该先问一句；「接着打」留下，再点 × →「退出，回地图」
    for (let k = 0; k < 2; k++) { await page.evaluate(() => { document.querySelector('.pkb-guard .pkb-opt:not([disabled])')?.click(); document.querySelector('.pkb-guard .pk-drill-check.is-ready')?.click(); }); await wait(700); await page.evaluate(() => [...document.querySelectorAll('.pkb-guard .pk-sheet .pk-btn')].find(e => e.getClientRects().length)?.click()); await wait(500); }
    await esc(page); await wait(500);
    const escDialog = await page.evaluate(() => [...document.querySelectorAll('dialog[open] button')].map(b => b.textContent.trim()));
    await page.evaluate(() => [...document.querySelectorAll('dialog[open] button')].find(b => b.textContent.trim() === '接着打')?.click()); await wait(400);
    const stayed = await view(page);
    const x = await clickX(page); await wait(500);
    const clicked = await confirmLeave(page) || await page.evaluate(() => { const b = [...document.querySelectorAll('dialog[open] button')].find(b => /^退出/.test(b.textContent.trim())); b?.click(); return b?.textContent.trim() || null; }); await wait(1200);
    return {escDialog, stayed, x, clicked, landed: await view(page), expect: 'gamemap'};
  },
  async notesDrill(page) {
    await deskReady(page, 'notes');
    const b = await clickText(page, /背一背|开始背|背诵/); await wait(2500);
    const started = await view(page), x = await xLabel(page);
    const {done} = await finishAndBack(page, 'notesDrill');
    const clicked = await clickText(page, /^回笔记本/); await wait(1500);
    return {b, started, x, done, clicked, landed: await view(page), expect: 'notes'};
  },
  async vocabDrill(page) {
    await deskReady(page, 'vocab');
    const b = await clickText(page, /背一背|开始背|背诵|练/); await wait(2500);
    const started = await view(page), x = await xLabel(page);
    const {done} = await finishAndBack(page, 'vocabDrill');
    const clicked = await clickText(page, /^回生词本/); await wait(1500);
    return {b, started, x, done, clicked, landed: await view(page), expect: 'vocab'};
  },
  // 考场：营地进 → 开考 → 暂离 → 回大厅 → × 回营地；地图进 → × 回地图；交卷 → 成绩页按钮
  async examLeave(page, {service}) {
    await seedPaper(service);
    await deskReady(page, 'today');
    await page.evaluate(() => window.__pinkieStudyDesk.go('gameexam')); await wait(1800);
    const x0 = await xLabel(page);
    await page.locator('.pke-prow .pkg-btn').click(); await page.locator('.pke-hall').waitFor({timeout: 10000}); await wait(600);
    await esc(page); await wait(400);
    const escStill = await page.evaluate(() => Boolean(document.querySelector('.pke-hall')));
    await page.evaluate(() => [...document.querySelectorAll('.pke-hall button')].find(b => b.textContent.trim() === '暂离')?.click()); await wait(400);
    const modal = await page.evaluate(() => [...document.querySelectorAll('.pke-modal button')].map(b => b.textContent.trim()));
    await page.evaluate(() => [...document.querySelectorAll('.pke-modal button')].find(b => b.textContent.trim() === '离开')?.click()); await wait(1200);
    const lobby = await view(page), hall = await page.evaluate(() => Boolean(document.querySelector('.pke-hall')));
    const x = await clickX(page); await wait(1000);
    const fromToday = await view(page);
    await page.evaluate(() => window.__pinkieStudyDesk.go('gamemap')); await wait(1200);
    await page.evaluate(() => window.__pinkieStudyDesk.go('gameexam')); await wait(1500);
    const xMap = await xLabel(page); await clickX(page); await wait(1000);
    return {x0, escStill, modal, lobby, hall, x, fromToday, xMap, fromMap: await view(page), expect: 'today / gamemap'};
  },
  async examSubmit(page, {service}) {
    await seedPaper(service);
    await deskReady(page, 'today');
    await page.evaluate(() => window.__pinkieStudyDesk.go('gameexam')); await wait(1800);
    await page.locator('.pke-prow .pkg-btn').click(); await page.locator('.pke-hall').waitFor({timeout: 10000}); await wait(600);
    await page.locator('.pke-submit').click(); await wait(500);
    await page.locator('.pke-modal .pkg-btn').click();
    await page.waitForFunction(() => document.querySelector('.pke-report'), null, {timeout: 90000}).catch(() => {});
    await wait(1500); await shotAt(page, 'examSubmit-report');
    const btns = await page.evaluate(() => [...document.querySelectorAll('.pke-report__act button')].map(b => b.textContent.trim()));
    const clicked = await page.evaluate(() => { const b = [...document.querySelectorAll('.pke-report__act button')].find(b => /^回/.test(b.textContent.trim())); b?.click(); return b?.textContent.trim() || null; }); await wait(1200);
    return {btns, clicked, landed: await view(page), expect: 'today'};
  },
  // 游戏各页左上角的 × / 返回 + Escape：从营地进去应回营地；衣橱 → 商店再关，应回衣橱
  async gamePagesBack(page) {
    const res = {};
    for (const v of ['gamepractice', 'gamemap', 'gamehunt', 'gameshop', 'gamegacha', 'gamewardrobe', 'gamecodex', 'gameexam']) {
      await deskReady(page, 'today');
      await page.evaluate(v => window.__pinkieStudyDesk.go(v), v); await wait(1200);
      const x = await clickX(page); await wait(900);
      res[v] = {x, landed: await view(page)};
    }
    for (const [a, b] of [['gamewardrobe', 'gameshop'], ['gameshop', 'gamegacha'], ['gamegacha', 'gamewardrobe'], ['gamecodex', 'gamewardrobe'], ['gamemap', 'gamehunt']]) {
      await deskReady(page, 'today');
      await page.evaluate(v => window.__pinkieStudyDesk.go(v), a); await wait(900);
      await page.evaluate(v => window.__pinkieStudyDesk.go(v), b); await wait(1200);
      const x1 = await xLabel(page); await clickX(page); await wait(900);
      const first = await view(page), x2 = await xLabel(page);
      await esc(page); await wait(900);
      res[`${a}>${b}`] = {x1, first, x2, escThen: await view(page), expect: `${a} then today`};
    }
    return res;
  },
  // 页面里的互跳按钮（衣橱「去商店」「去扭蛋」、图鉴、商店……）：列出每页能跳去哪
  async crossLinks(page) {
    const res = {};
    for (const v of ['gameshop', 'gamegacha', 'gamewardrobe', 'gamecodex', 'gamehunt', 'gamemap']) {
      await deskReady(page, 'today');
      await page.evaluate(v => window.__pinkieStudyDesk.go(v), v); await wait(1500);
      res[v] = await page.evaluate(() => [...document.querySelectorAll('#pinkie-study-desk .view button')].filter(b => b.getClientRects().length && /去|回|看|打开/.test(b.textContent)).map(b => b.textContent.trim().replace(/\s+/g, ' ').slice(0, 18)));
    }
    return res;
  },
};

const {harness, service, close} = await harnessWithGame({monsters: false});
seedBank(service);
const report = {};
try {
  for (const [name, fn] of Object.entries(FLOWS)) {
    if (only && !only.includes(name)) continue;
    seedMonsters(service, SEEDS, {level: [2, 3]});
    const page = await openWk(harness, {theme: 'light'});
    try { report[name] = await fn(page, {service}); }
    catch (e) { report[name] = {error: String(e.message || e).slice(0, 300)}; }
    try { await page.screenshot({path: path.join(out, `${name}.png`)}); } catch { /* ignore */ }
    report[name].errors = await page.evaluate(() => window.__qaErrors || []).catch(() => null);
    console.log(name, JSON.stringify(report[name]));
    await page.close();
  }
} finally { await close(); }
fs.writeFileSync(path.join(out, 'flows.json'), JSON.stringify(report, null, 1));
// 判定：落点对不对、按钮有没有写「返回」这种不说去哪的字、有没有脚本错误
const bad = [];
for (const [name, r] of Object.entries(report)) {
  if (r.error) bad.push(`${name}: ${r.error}`);
  if (typeof r.expect === 'string' && /^[a-z]+$/.test(r.expect) && r.landed !== r.expect) bad.push(`${name}: landed ${r.landed}, expected ${r.expect}`);
  if (r.errors?.length) bad.push(`${name}: page errors ${r.errors.join(' | ')}`);
  const labels = JSON.stringify(r).match(/"(返回|再试一次)"/g); if (labels && name !== 'crossLinks') bad.push(`${name}: vague button ${labels.join(',')}`);
  for (const [k, v] of Object.entries(r)) if (v && typeof v === 'object' && 'expect' in v && !String(v.expect).includes(' ') && v.landed && v.landed !== v.expect) bad.push(`${name}.${k}: landed ${v.landed}`);
  if (name === 'gamePagesBack') for (const [k, v] of Object.entries(r)) if (k.includes('>') && (v.first !== k.split('>')[0] || v.escThen !== 'today')) bad.push(`${name}.${k}: ${v.first} → ${v.escThen}`);
  if (name === 'examLeave' && (r.fromToday !== 'today' || r.fromMap !== 'gamemap')) bad.push(`examLeave: ${r.fromToday} / ${r.fromMap}`);
}
console.log(bad.length ? `FLOW FAIL (${bad.length})\n  ` + bad.join('\n  ') : `FLOW OK · ${Object.keys(report).length} flows`);
if (bad.length) process.exitCode = 1;
