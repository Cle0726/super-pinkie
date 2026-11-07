// 背一背隔离验收：假组卷 + 真实奖励层 / 播放器。不连正在运行的网关，不碰真实学习数据。
// 用法：node --test tools/study-desk/drill-qa.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {startHarness} from './harness.mjs';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= '/tmp/pinkie-playwright-browsers';
try {
  const ffmpegDir = path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'ffmpeg-1011');
  fs.mkdirSync(ffmpegDir, {recursive: true});
  const ffmpegBin = path.join(ffmpegDir, 'ffmpeg-mac');
  if (!fs.existsSync(ffmpegBin) && fs.existsSync('/opt/homebrew/bin/ffmpeg')) fs.symlinkSync('/opt/homebrew/bin/ffmpeg', ffmpegBin);
} catch { /* 没有系统 ffmpeg 时结算录像会跳过 */ }

const repo = fileURLToPath(new URL('../../', import.meta.url));
const shots = path.join(repo, 'design/study-desk-drill/shots');
const MODES = ['look', 'flip', 'choice', 'truefalse', 'cloze', 'pairs', 'order', 'write', 'meet', 'word2meaning', 'meaning2word', 'listen', 'collocation', 'homophonePairs', 'spell', 'dictate'];
const item = (mode, fields) => ({itemId: mode, cardRef: {book: 'notes', noteId: 'n-' + mode, recallId: 'r-' + mode, wordId: 'w-' + mode}, mode, strength: 1, answer: '', reveal: {question: '', answer: ''}, ...fields, itemId: mode});
export const FIXTURES = {
  look: item('look', {strength: 0, prompt: 'TCP 三次握手的第二步是什么？', reveal: {question: 'TCP 三次握手的第二步是什么？', answer: '服务器回 SYN-ACK。'}}),
  flip: item('flip', {prompt: 'sizeof 一个字符串为什么比 strlen 大 1？', reveal: {answer: '末尾还有一个 \\0。'}}),
  choice: item('choice', {prompt: 'do-while 的循环体至少执行几次？', options: ['可能一次也不执行', '至少一次', '必须是偶数次', '和 while 完全一样'], answer: 1, reveal: {answer: '至少一次'}}),
  truefalse: item('truefalse', {prompt: 'int a[10] 的合法下标是 0 到 9。', options: ['对', '错'], answer: 0, reveal: {answer: '对。下标从 0 到 9。'}}),
  cloze: item('cloze', {prompt: 'be used to {{1}} 表示习惯于，这里的 to 是介词。', answer: ['doing'], bank: ['doing', 'do', 'done', 'to do'], reveal: {answer: 'doing'}}),
  pairs: item('pairs', {prompt: '把左边的问题和右边的答案配上', pairs: {left: ['avoid 后面', 'do-while', '数组下标', 'sizeof 字符串'], right: ['接 doing', '至少一次', '从 0 开始', '比长度多 1']}, answer: [[0, 0], [1, 1], [2, 2], [3, 3]], reveal: {answer: '按左边顺序对应右边。'}}),
  order: item('order', {strength: 3, prompt: '把 TCP 三次握手排成正确顺序', steps: ['客户端发送 SYN', '服务器回复 SYN-ACK', '客户端发送 ACK'], reveal: {answer: 'SYN → SYN-ACK → ACK'}}),
  write: item('write', {strength: 3, prompt: '用一句话写出 do-while 和 while 的差别', judge: 'model', answer: 'do-while 至少执行一次', reveal: {answer: 'do-while 先执行再判断，至少一次。'}}),
  meet: item('meet', {strength: 0, prompt: 'ambulance', speak: 'ambulance', reveal: {question: 'ambulance', answer: '救护车', extra: '/ˈæmbjələns/ · 谐音：俺不能死'}}),
  word2meaning: item('word2meaning', {prompt: 'ambulance', options: ['救护车', '大使馆', '雄心', '含糊的'], answer: 0, reveal: {answer: '救护车'}}),
  meaning2word: item('meaning2word', {prompt: '救护车', options: ['ambulance', 'embassy', 'ambition', 'ambiguous'], answer: 0, reveal: {answer: 'ambulance'}}),
  listen: item('listen', {prompt: '听发音，选出听到的词', speak: 'ambition', options: ['ambition', 'ambulance', 'ambiguous', 'embassy'], answer: 0, reveal: {answer: 'ambition'}}),
  collocation: item('collocation', {prompt: 'have an impact {{1}} the result', answer: ['on'], bank: ['on', 'in', 'to', 'at'], reveal: {answer: 'on'}}),
  homophonePairs: item('homophonePairs', {prompt: '单词对上碧琪编的谐音', pairs: {left: ['ambulance', 'ambition', 'embassy'], right: ['俺不能死', '俺必胜', '安倍喜']}, answer: [[0, 0], [1, 1], [2, 2]], reveal: {answer: '谐音只帮记忆。'}}),
  spell: item('spell', {strength: 3, prompt: '救护车', speak: 'ambulance', answer: 'ambulance', reveal: {answer: 'ambulance'}}),
  dictate: item('dictate', {strength: 3, prompt: '听写这个词', speak: 'embassy', answer: 'embassy', reveal: {answer: 'embassy'}}),
};

export function drillHandler() {
  const sessions = new Map();
  return async (method, params = {}) => {
    const name = method.replace(/^pinkie\.learning\./, '');
    if (name === 'drill.settings.get') return {size: 10, jarGoal: 30, flipOnly: false};
    if (name === 'drill.settings.set') return {ok: true};
    if (name === 'drill.session') {
      const mode = params.scope?.ids?.[0];
      const one = FIXTURES[mode] ? structuredClone(FIXTURES[mode]) : null;
      const items = one ? [one] : MODES.map(id => structuredClone(FIXTURES[id]));
      const sessionId = 'qa-' + Math.random().toString(16).slice(2);
      sessions.set(sessionId, {items, answers: []});
      return {sessionId, items, pending: params.scope?.flag === 'pending' ? 4 : 0, dueLeft: items.length, settings: {soundDefault: true}};
    }
    if (name === 'drill.answer') {
      const session = sessions.get(params.sessionId);
      session?.answers.push(params);
      return {rating: params.correct ? (params.hinted || params.verdict === 'partial' ? 'fuzzy' : 'remembered') : 'forgot', stars: params.correct && params.firstTry ? 1 : 0, requeue: !params.correct};
    }
    if (name === 'drill.learned') return {ok: true};
    if (name === 'drill.judge') {
      const text = String(params.text || '');
      if (!text.trim() || text.includes('错')) return {verdict: 'wrong', missing: ['至少一次'], comment: '先记「至少一次」'};
      if (text.includes('部分')) return {verdict: 'partial', missing: ['while 可能一次也不执行'], comment: '差在 while 那边'};
      return {verdict: 'correct', missing: [], comment: '意思对了'};
    }
    if (name === 'drill.finish') {
      const session = sessions.get(params.sessionId);
      const first = (session?.answers || []).filter(a => a.firstTry);
      const right = first.filter(a => a.correct).length;
      return {stars: right + 5, accuracy: first.length ? right / first.length : 1, ms: 240000, maxCombo: right, firstFinishToday: true, streak: {current: 3, best: 3, stampedToday: true, leaveUsedYesterday: false}, jar: {today: 12, goal: 30, filledNow: false}, leaveNotes: 1, quiet: false, nextSuggestion: {source: 'notes', scope: {kind: 'more'}, label: '再背一组新的'}};
    }
    if (name === 'drill.cheer') return {line: '计算机网络这组，握手的顺序你已经能自己排了。'};
    if (name === 'chat.history') return {messages: []};
    if (name === 'chat.send') return {runId: 'qa', status: 'started'};
    return {};
  };
}

function launch() {
  const req = createRequire(import.meta.url);
  const root = '/Applications/超級碧琪.app/Contents/Resources/SuperPinkie/runtime/openclaw/node_modules';
  let pw; try { pw = req('playwright'); } catch { pw = req(root + '/playwright-core'); }
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return pw.chromium.launch({headless: true, ...(fs.existsSync(chrome) ? {executablePath: chrome} : {})});
}
async function theme(page, night) {
  await page.evaluate(night => { document.documentElement.dataset.themeMode = night ? 'dark' : 'light'; document.documentElement.toggleAttribute('data-pinkie-night', night); }, night);
  await page.waitForFunction(night => document.getElementById('pinkie-study-desk')?.dataset.theme === (night ? 'night' : 'day'), night);
}
const start = (page, opts) => page.evaluate(opts => window.__pinkieDrill.start(opts), opts);

async function answer(page, mode, verdict) {
  const card = FIXTURES[mode];
  if (mode === 'look' || mode === 'meet') {
    if (verdict === 'wrong') return false;
    await page.getByRole('button', {name: '记住了'}).click();
    return true;
  }
  if (mode === 'flip') {
    await page.getByRole('button', {name: '翻面'}).click();
    await page.getByRole('button', {name: verdict === 'wrong' ? '忘了' : '记得'}).click();
    return true;
  }
  if (mode === 'cloze' || mode === 'collocation') {
    await page.locator('.pk-chip').nth(verdict === 'wrong' ? 1 : 0).click();
    await page.locator('.pk-drill-check').click();
    return true;
  }
  if (mode === 'pairs' || mode === 'homophonePairs') {
    const cols = page.locator('.pk-pair-col');
    if (verdict === 'wrong') { await cols.nth(0).locator('button').nth(0).click(); await cols.nth(1).locator('button').nth(1).click(); return true; }
    const n = await cols.nth(0).locator('button').count();
    for (let i = 0; i < n; i++) {
      await cols.nth(0).locator('button:not([disabled])').first().click();
      await cols.nth(1).locator('button:not([disabled])').first().click();
    }
    await page.locator('.pk-drill-check').click();
    return true;
  }
  if (mode === 'order') {
    if (verdict === 'wrong') { for (let i = 0; i < card.steps.length; i++) await page.locator('.pk-order-bank .pk-choice').first().click(); }
    else for (const step of card.steps) await page.locator('.pk-order-bank .pk-choice', {hasText: step}).click();
    await page.locator('.pk-drill-check').click();
    return true;
  }
  if (mode === 'write') {
    await page.locator('textarea.pk-drill-input').fill(verdict === 'wrong' ? '完全错了' : 'do-while 至少执行一次');
    await page.locator('.pk-drill-check').click();
    return true;
  }
  if (mode === 'spell' || mode === 'dictate') {
    await page.locator('input.pk-drill-input').fill(verdict === 'wrong' ? 'xxxx' : card.answer);
    await page.locator('.pk-drill-check').click();
    return true;
  }
  const index = verdict === 'wrong' ? (card.answer === 0 ? 1 : 0) : card.answer;
  await page.locator('.pk-choice').nth(index).click();
  await page.locator('.pk-drill-check').click();
  return true;
}

test('reward source only animates transform and opacity', () => {
  const dir = path.join(repo, 'ui/injections');
  const js = fs.readFileSync(path.join(dir, 'laolao-desk-reward.js'), 'utf8') + fs.readFileSync(path.join(dir, 'laolao-study-desk-drill.js'), 'utf8');
  const css = fs.readFileSync(path.join(dir, 'laolao-desk-reward.css'), 'utf8') + fs.readFileSync(path.join(dir, 'laolao-study-desk-drill.css'), 'utf8');
  assert.equal(/deviceMemory|hardwareConcurrency|matchMedia\(\s*['"]\(prefers-reduced/.test(js), false);
  assert.equal(/requestAnimationFrame/.test(js), false);
  assert.equal(/backdrop-filter/.test(css), false);
  assert.equal(/#58cc02|owl|feather bold/i.test(js + css), false);
  for (const frame of css.match(/@keyframes[^{]+\{[^{}]*\}/g) || []) {
    assert.match(frame, /transform|opacity/);
    assert.equal(/width|height|left|top|filter|box-shadow/.test(frame), false);
  }
});

test('A1 reward demo recording', {timeout: 120_000}, async () => {
  const say = message => fs.writeSync(1, message + '\n');
  say('a1 enter');
  fs.mkdirSync(path.dirname(shots), {recursive: true});
  const log = path.join(repo, 'design/study-desk-drill/demo-a1-error.txt');
  const note = text => fs.writeFileSync(log, text);
  say('harness');
  const harness = await startHarness({handler: drillHandler()});
  say('launch');
  const browser = await launch();
  say('context');
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, recordVideo: {dir: path.dirname(shots), size: {width: 1440, height: 900}}});
  say('page');
  let page;
  try { page = await context.newPage(); say('page ok'); }
  catch (error) { say('page fail ' + (error.stack || error.message)); throw error; }
  const errors = [];
  const logLine = line => fs.appendFileSync(log, line + '\n');
  page.on('pageerror', error => { errors.push(error.message); logLine('PAGE ' + error.message); });
  page.on('console', msg => { if (msg.type() === 'error') { errors.push(msg.text()); logLine('CONSOLE ' + msg.text()); } });
  try {
    logLine('goto');
    await page.goto(harness.url);
    logLine('wait symbols');
    await page.waitForFunction(() => window.__pinkieStudyDesk && window.__pinkieDrill && window.__pinkieDeskReward, null, {timeout: 15000});
    logLine('start');
    await start(page, {demo: true});
    logLine('started');
    await page.waitForFunction(() => document.querySelector('.pk-drill')?.dataset.demo === 'done', null, {timeout: 40_000});
    await page.screenshot({path: path.join(shots, 'demo-a1-end.png')});
    if (errors.length) throw new Error(errors.join('\n'));
    note('ok');
  } catch (error) {
    logLine('FAIL ' + (error.stack || error.message));
    throw error;
  } finally {
    try { if (page) await Promise.race([page.close(), new Promise(resolve => setTimeout(resolve, 4000))]); } catch { /* 页面已关 */ }
    try {
      const video = page?.video?.();
      if (video) {
        const saved = path.join(repo, 'design/study-desk-drill/demo-a1.webm');
        await Promise.race([video.saveAs(saved), new Promise(resolve => setTimeout(resolve, 8000))]);
        try { fs.copyFileSync(saved, path.join(repo, 'design/study-desk-drill/demo.webm')); } catch { /* 录像还没落盘 */ }
      }
    } catch { /* 没有录像 */ }
    try { await Promise.race([context?.close(), new Promise(resolve => setTimeout(resolve, 3000))]); } catch {}
    try { await Promise.race([browser?.close(), new Promise(resolve => setTimeout(resolve, 3000))]); } catch {}
    try { await harness?.close(); } catch {}
  }
});

test('drill player shots, reduced motion and idle', {timeout: 600_000}, async () => {
  fs.mkdirSync(shots, {recursive: true});
  const harness = await startHarness({handler: drillHandler()});
  const browser = await launch();
  const errors = [];
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}});
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(harness.url);
    await page.waitForFunction(() => window.__pinkieDrill);
    const widths = [360, 640, 1000];
    for (const mode of MODES) for (const verdict of ['right', 'wrong']) {
      if ((mode === 'look' || mode === 'meet') && verdict === 'wrong') continue;
      await start(page, {source: mode === 'spell' || mode === 'dictate' || mode.startsWith('word') || mode === 'meet' || mode === 'listen' || mode === 'collocation' || mode === 'homophonePairs' ? 'vocab' : 'notes', scope: {kind: 'notes', ids: [mode]}, size: 5, force: true});
      await page.locator('.pk-drill-q').waitFor();
      const showed = await answer(page, mode, verdict);
      assert.equal(showed, true);
      if (!((mode === 'pairs' || mode === 'homophonePairs') && verdict === 'wrong')) await page.locator('.pk-sheet').waitFor({timeout: 8000});
      await page.evaluate(async () => {
        const gsap = window.__pinkieDeskVendors?.gsap;
        for (const tween of gsap?.globalTimeline?.getChildren(true, true, true) || []) tween.progress?.(1);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      for (const night of [false, true]) {
        await theme(page, night);
        for (const width of widths) {
          const label = `${mode}-${verdict}-${night ? 'night' : 'day'}-${width}`;
          fs.writeSync(1, label + '\n');
          await page.evaluate(width => { const node = document.querySelector('.pk-drill'); node.style.width = width + 'px'; node.style.maxWidth = width + 'px'; }, width);
          const overflow = await page.evaluate(() => [...document.querySelectorAll('.pk-drill, .pk-drill-top, .pk-drill-stage, .pk-drill-q, .pk-sheet, .pk-choice, .pk-pairs, .pk-pair-col, .pk-chip')].map(node => ({cls: String(node.className).split(' ')[0], over: node.scrollWidth - node.clientWidth})));
          const worst = overflow.reduce((a, b) => b.over > a.over ? b : a, {over: 0, cls: ''});
          const detail = overflow.filter(item => item.over > 2).map(item => `${item.cls}:${item.over}`).join(' ');
          assert.ok(worst.over <= 2, `${label} 溢出 ${worst.over}px ${worst.cls} ${detail}`);
          await page.locator('.pk-drill').screenshot({path: path.join(shots, `${label}.png`), animations: 'disabled', timeout: 15000});
        }
      }
    }
    await page.evaluate(() => { const node = document.querySelector('.pk-drill'); if (node) node.style.width = ''; });
    await start(page, {source: 'notes', scope: {kind: 'notes', ids: ['flip'], flag: 'pending'}, force: true});
    await page.getByText('碧琪还在给 4 张卡出题').waitFor();
    await start(page, {demo: true, auto: false});
    await page.locator('.pk-drill-stem').waitFor();
    const summaries = {
      normal: {stars: 12, accuracy: .8, ms: 252000, maxCombo: 3, firstFinishToday: false, streak: {current: 2, week: [true, true, false, false, false, false, false]}, jar: {today: 12, goal: 30, filledNow: false}, quiet: false},
      full: {stars: 20, accuracy: 1, ms: 180000, maxCombo: 10, firstFinishToday: true, streak: {current: 6, stampedToday: true, week: [true, true, true, true, true, true, false]}, jar: {today: 30, goal: 30, filledNow: true}, quiet: false},
      quiet: {stars: 8, accuracy: .7, ms: 200000, maxCombo: 2, firstFinishToday: true, streak: {current: 5, week: [true, true, true, true, true, false, false]}, jar: {today: 18, goal: 30, filledNow: false}, quiet: true},
    };
    for (const [name, summary] of Object.entries(summaries)) {
      await page.evaluate(summary => { document.querySelector('.pk-done')?.remove(); window.__pinkieDeskReward.completeScreen(document.querySelector('.pk-drill'), summary, {cheer: Promise.resolve(summary.quiet ? '这一页背完了，早点休息' : '这一页的握手你排对了。'), onAgain() {}, onBack() {}}); }, summary);
      await page.locator('.pk-done-title').waitFor();
      await page.waitForTimeout(2200);
      await theme(page, false);
      await page.locator('.pk-done').screenshot({path: path.join(shots, `complete-${name}-day-1000.png`)});
      await theme(page, true);
      await page.locator('.pk-done').screenshot({path: path.join(shots, `complete-${name}-night-1000.png`)});
    }
    assert.equal(errors.filter(message => !/ResizeObserver/.test(message)).length, 0, errors.join('\n'));
  } finally { await browser.close(); await harness.close(); }

  const reducedHarness = await startHarness({handler: drillHandler()});
  const reducedBrowser = await launch();
  try {
    const context = await reducedBrowser.newContext({viewport: {width: 1280, height: 800}, reducedMotion: 'reduce'});
    await context.addInitScript(() => { const orig = window.requestAnimationFrame; window.__rafCount = 0; window.requestAnimationFrame = function(cb) { window.__rafCount++; return orig.call(window, cb); }; });
    const page = await context.newPage();
    await page.goto(reducedHarness.url);
    await page.waitForFunction(() => window.__pinkieDrill);
    await start(page, {demo: true, auto: false});
    await page.locator('.pk-drill').waitFor();
    await page.evaluate(async () => {
      const host = document.querySelector('.pk-drill');
      const reward = window.__pinkieDeskReward;
      reward.feedbackSheet(host, {kind: 'right', title: '对啦！', line: '稳。', onContinue() {}});
      reward.comboBadge(host, 3);
      const jar = document.createElement('div'); host.append(jar);
      const api = reward.starJar(jar, {today: 4, goal: 30});
      await reward.starsFly(host.querySelector('.pk-drill-stem'), api.svg, 4);
      await api.add(4); await api.full();
    });
    await page.waitForTimeout(250);
    const motion = await page.evaluate(() => {
      const running = document.getAnimations().filter(animation => animation.playState === 'running');
      const transformed = running.filter(animation => (animation.effect?.getKeyframes?.() || []).some(frame => frame.transform && frame.transform !== 'none'));
      const gsap = window.__pinkieDeskVendors?.gsap;
      const tweens = (gsap?.globalTimeline.getChildren(true, true, true) || []).filter(tween => tween.isActive?.());
      const moved = tweens.filter(tween => Object.keys(tween.vars || {}).some(key => /^(x|y|scale|scaleX|scaleY|rotate|rotation|yPercent|xPercent)$/.test(key)));
      return {running: running.length, transformed: transformed.length, moved: moved.length};
    });
    assert.equal(motion.transformed, 0, '减少动效时还有 transform 动画');
    assert.equal(motion.moved, 0, '减少动效时 GSAP 还在做位移');
    await page.waitForTimeout(400);
    const idle = await page.evaluate(() => ({
      running: document.getAnimations().filter(animation => animation.playState === 'running').length,
      tweens: (window.__pinkieDeskVendors?.gsap?.globalTimeline.getChildren(true, true, true) || []).filter(tween => tween.isActive?.()).length,
    }));
    assert.equal(idle.running, 0);
    assert.equal(idle.tweens, 0);
    const before = await page.evaluate(() => window.__rafCount);
    await page.waitForTimeout(3000);
    const after = await page.evaluate(() => window.__rafCount);
    assert.equal(after, before, `空闲 3 秒 rAF 仍在增加 ${before} → ${after}`);
  } finally { await reducedBrowser.close(); await reducedHarness.close(); }
});
