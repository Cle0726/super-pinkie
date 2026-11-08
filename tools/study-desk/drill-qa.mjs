// 背一背隔离验收：假组卷 + 真实奖励层 / 播放器。不连正在运行的网关，不碰真实学习数据。
// 用法：node --test tools/study-desk/drill-qa.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
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
import {FIXTURES, MODES, SUMMARIES, drillHandler} from './drill-fixtures.mjs';

// 系统 Chrome 的 headless 录屏只截窗口实际大小（默认比视口矮约 90px，底下补灰条）；录像时把窗口设成和视口一样大。
function launch(args = []) {
  const req = createRequire(import.meta.url);
  const root = '/Applications/超級碧琪.app/Contents/Resources/SuperPinkie/runtime/openclaw/node_modules';
  let pw; try { pw = req('playwright'); } catch { pw = req(root + '/playwright-core'); }
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return pw.chromium.launch({headless: true, args, ...(fs.existsSync(chrome) ? {executablePath: chrome} : {})});
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
    // 答错：先连错一次（左 1 配右 2），再把整组配完，反馈条应是「差一点点」。
    if (verdict === 'wrong') { await cols.nth(0).locator('button').nth(0).click(); await cols.nth(1).locator('button').nth(1).click(); await page.waitForTimeout(350); }
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

// 等结算页的动画全部走完（星星进罐、盖章、滚数字），再截图；罐子终态要和数字一致。
async function settled(page) {
  await page.locator('.pk-done[data-settled="1"]').waitFor({timeout: 12_000});
  await page.evaluate(async () => {
    const gsap = window.__pinkieDeskVendors?.gsap;
    for (const tween of gsap?.globalTimeline?.getChildren(true, true, true) || []) tween.progress?.(1);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}
async function jarMatches(page) {
  const jar = await page.evaluate(() => {
    const done = document.querySelector('.pk-done');
    const cap = done?.querySelector('.pk-jar figcaption')?.textContent || '';
    const level = done?.querySelector('.pk-jar-water')?.style.transform || '';
    return {cap, level};
  });
  const [today, goal] = jar.cap.split('/').map(n => Number(n.trim()));
  const scale = Number(/scaleY\(([\d.]+)\)/.exec(jar.level)?.[1]);
  assert.ok(Math.abs(scale - Math.max(0.001, Math.min(1, today / goal))) < 0.01, `罐子水位 ${jar.level} 和数字 ${jar.cap} 对不上`);
}
function showDone(page, summary, cheer) {
  return page.evaluate(({summary, cheer}) => {
    document.querySelector('.pk-done')?.remove();
    window.__pinkieDeskReward.completeScreen(document.querySelector('.pk-drill'), summary, {cheer: Promise.resolve(cheer), requireSuggestion: true, onAgain() {}, onBack() {}});
  }, {summary, cheer});
}

test('A1 reward demo recording', {timeout: 180_000}, async () => {
  // 录像：视口和视频同尺寸；依次录答对、答错、连对 3/5/10、普通结算、首次盖章 + 罐满、考前安静版。
  // 原始录像先落在临时目录，学习台出现之前的几帧（harness 的红色占位层）用 ffmpeg 剪掉。
  const size = {width: 1440, height: 900};
  const raw = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-drill-video-'));
  const harness = await startHarness({handler: drillHandler()});
  const browser = await launch([`--window-size=${size.width},${size.height}`]);
  const context = await browser.newContext({viewport: size, recordVideo: {dir: raw, size}});
  const page = await context.newPage();
  const born = Date.now();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let offset = 0;
  try {
    await page.goto(harness.url);
    await page.waitForFunction(() => window.__pinkieStudyDesk && window.__pinkieDrill && window.__pinkieDeskReward, null, {timeout: 15000});
    const second = {...structuredClone(FIXTURES.choice), itemId: 'choice-2', prompt: 'for 循环里 continue 会怎样？', options: ['结束整个循环', '跳过这一次', '从头再来', '什么也不做'], answer: 1};
    await start(page, {demo: true, auto: false, items: [structuredClone(FIXTURES.choice), second]});
    await page.locator('.pk-drill-stem').waitFor();
    await page.waitForTimeout(600);
    offset = (Date.now() - born) / 1000;
    const pick = async i => { await page.locator('.pk-drill-options .pk-choice').nth(i).click(); await page.waitForTimeout(350); await page.locator('.pk-drill-check').click(); };
    await page.waitForTimeout(900);
    await pick(1);                                        // 答对
    await page.waitForTimeout(2200);
    await page.locator('.pk-sheet .pk-btn').click();
    await page.waitForTimeout(1000);
    await pick(0);                                        // 答错
    await page.waitForTimeout(2600);
    await page.locator('.pk-sheet .pk-btn').click();
    await page.waitForTimeout(500);
    for (const n of [3, 5, 10]) {                         // 连对 3 / 5 / 10
      await page.evaluate(n => window.__pinkieDeskReward.comboBadge(document.querySelector('.pk-drill-combo'), n), n);
      await page.waitForTimeout(1500);
    }
    await showDone(page, SUMMARIES.normal, '握手的顺序你已经能自己排了');
    await settled(page); await page.waitForTimeout(1800);
    await showDone(page, SUMMARIES.full, '计网这组一道没错，ARP 那张也记住了');
    await settled(page); await page.waitForTimeout(2600);
    await showDone(page, SUMMARIES.quiet, '考前别熬，今晚早点睡');
    await settled(page); await page.waitForTimeout(2200);
    await jarMatches(page);
    await page.screenshot({path: path.join(shots, 'demo-a1-end.png')});
    assert.equal(errors.length, 0, errors.join('\n'));
  } finally {
    await page.close();
    const video = page.video();
    const source = video ? await video.path() : '';
    await context.close(); await browser.close(); await harness.close();
    if (source && fs.existsSync(source)) {
      const saved = path.join(repo, 'design/study-desk-drill/demo-a1.webm');
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', offset.toFixed(2), '-i', source, '-c:v', 'libvpx', '-b:v', '2500k', '-an', saved]);
      fs.copyFileSync(saved, path.join(repo, 'design/study-desk-drill/demo.webm'));
      const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', saved], {encoding: 'utf8'});
      const info = JSON.parse(probe);
      assert.equal(info.streams[0].width, size.width);
      assert.equal(info.streams[0].height, size.height);
      assert.ok(Number(info.format.duration) >= 24, `录像只有 ${info.format.duration} 秒`);
      fs.writeSync(1, `demo-a1.webm ${info.streams[0].width}x${info.streams[0].height} ${Number(info.format.duration).toFixed(1)}s\n`);
    }
    fs.rmSync(raw, {recursive: true, force: true});
  }
});

test('a failed finish shows real local numbers, no stamp, no confetti, and can retry', {timeout: 60_000}, async () => {
  const control = {finishFails: 1};
  const harness = await startHarness({handler: drillHandler(control)});
  const browser = await launch();
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}});
    await page.goto(harness.url);
    await page.waitForFunction(() => window.__pinkieDrill && window.__pinkieStudyDesk);
    await start(page, {source: 'notes', scope: {kind: 'notes', ids: ['choice']}, size: 5, force: true});
    await page.locator('.pk-drill-options').waitFor();
    await page.evaluate(() => {
      window.__confetti = 0;
      const desk = window.__pinkieStudyDesk;
      for (const motion of new Set([desk.motion, ...(desk.contexts?.() || []).map(c => c.motion)].filter(Boolean))) {
        const orig = motion.confettiAt;
        motion.confettiAt = (...args) => { window.__confetti += 1; return orig?.apply(motion, args); };
      }
    });
    await answer(page, 'choice', 'right');
    await page.locator('.pk-sheet .pk-btn').click();
    await page.locator('.pk-done[data-state="failed"]').waitFor();
    await settled(page);
    const failed = await page.evaluate(() => {
      const done = document.querySelector('.pk-done');
      return {text: done.innerText, seal: done.querySelectorAll('.pk-seal').length, jar: done.querySelectorAll('.pk-jar').length,
        stars: done.querySelector('.pk-stick b')?.textContent, retry: Boolean(done.querySelector('.pk-btn[aria-label="再试一次"]')), confetti: window.__confetti};
    });
    assert.equal(failed.seal, 0, '结算失败还盖了章');
    assert.equal(failed.jar, 0, '结算失败还摆了罐子');
    assert.equal(failed.confetti, 0, '结算失败还撒了纸屑');
    assert.equal(/4 天|30 \/ 30|30\/30/.test(failed.text), false, failed.text);
    assert.match(failed.text, /结算没记上，星星已经记了/);
    assert.equal(failed.stars, '+1');
    assert.match(failed.text, /100%/);
    assert.equal(failed.retry, true);
    await page.locator('.pk-done .pk-btn[aria-label="再试一次"]').click();
    await page.locator('.pk-done[data-state="ok"]').waitFor();
    await settled(page);
    assert.equal(await page.locator('.pk-done .pk-seal').count(), 1);
  } finally { await browser.close(); await harness.close(); }
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
      // 每一种题型的「答错」截图都必须真的停在答错的反馈条上。
      await page.locator('.pk-sheet').waitFor({timeout: 8000});
      if (verdict === 'wrong' && mode !== 'flip') {
        const kind = await page.locator('.pk-sheet').getAttribute('data-kind');
        assert.ok(kind === 'wrong' || kind === 'partial', `${mode} 答错停在了 ${kind}`);
      }
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
          if (mode === 'pairs' || mode === 'homophonePairs') {
            // 窄卡也保持两栏：两栏顶端对齐，各有「问 / 答」小标题。
            const cols = await page.evaluate(() => [...document.querySelectorAll('.pk-pair-col')].map(col => ({top: Math.round(col.getBoundingClientRect().top), head: col.querySelector('.pk-pair-head')?.textContent || ''})));
            assert.equal(cols.length, 2);
            assert.equal(cols[0].top, cols[1].top, `${label} 配对两栏没有并排`);
            assert.ok(cols[0].head && cols[1].head);
          }
          if (width === 1000) {
            const sizes = await page.evaluate(() => ({stem: parseFloat(getComputedStyle(document.querySelector('.pk-drill-stem, .pk-drill-cloze')).fontSize),
              option: parseFloat(getComputedStyle(document.querySelector('.pk-choice') || document.body).fontSize)}));
            assert.ok(sizes.stem >= 22, `${label} 题干 ${sizes.stem}px`);
            if (await page.locator('.pk-choice').count()) assert.ok(sizes.option >= 16, `${label} 选项 ${sizes.option}px`);
          }
          await page.locator('.pk-drill').screenshot({path: path.join(shots, `${label}.png`), animations: 'disabled', timeout: 15000});
        }
      }
    }
    await page.evaluate(() => { const node = document.querySelector('.pk-drill'); if (node) node.style.width = ''; });
    await start(page, {source: 'notes', scope: {kind: 'notes', ids: ['flip'], flag: 'pending'}, force: true});
    await page.getByText('碧琪还在给 4 张卡出题').waitFor();
    await start(page, {demo: true, auto: false});
    await page.locator('.pk-drill-stem').waitFor();
    for (const [name, summary] of Object.entries(SUMMARIES)) {
      for (const width of [1000, 360]) {
        await page.evaluate(width => { const node = document.querySelector('.pk-drill'); node.style.width = width + 'px'; node.style.maxWidth = width + 'px'; }, width);
        await theme(page, false);
        await showDone(page, summary, summary.quiet ? '考前别熬，今晚早点睡' : '握手的顺序你已经能自己排了');
        await settled(page);
        await jarMatches(page);
        const title = await page.locator('.pk-done-title').textContent();
        const line = await page.locator('.pk-done-line').textContent();
        assert.notEqual(title, line, '标题和碧琪那句重复');
        assert.equal(await page.locator('.pk-done .pk-btn[aria-label="再背一组"]').isVisible(), summary.nextSuggestion !== null, `${name} 再背一组按钮`);
        const big = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.pk-stick b')).fontSize));
        assert.ok(big >= 32, `${name}-${width} 便签数字 ${big}px`);
        await page.locator('.pk-done').screenshot({path: path.join(shots, `complete-${name}-day-${width}.png`)});
        await theme(page, true);
        await page.locator('.pk-done').screenshot({path: path.join(shots, `complete-${name}-night-${width}.png`)});
      }
    }
    await page.evaluate(() => { const node = document.querySelector('.pk-drill'); node.style.width = '1000px'; node.style.maxWidth = '1000px'; });
    await theme(page, false);
    await showDone(page, {failed: true, stars: 7, accuracy: .75, ms: 196000, maxCombo: 4}, '');
    await settled(page);
    await page.locator('.pk-done').screenshot({path: path.join(shots, 'complete-failed-day-1000.png')});
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
