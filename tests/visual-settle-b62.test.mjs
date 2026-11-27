// B62 / B51 复发防护：visual-baseline 的 3 遍确定性在 CI Linux 上偶发差 6–8 px。
// captureScenePng 必须等画面停下来（隔两帧连拍，连续两张逐字节相同）再交出截图，
// 而不是拿 openScenePage 之后的第一张。这里用假的 browser / page（不启动浏览器）锁住：
// - 前几张还在变时，交出的是停下来之后的那张；
// - 一直在变时，直接报错，不悄悄交出一张没画完的；
// - 已经稳定的页面只多拍一张，结果不变（不影响现有基线）。
import assert from 'node:assert/strict';
import test from 'node:test';
import {SETTLE_MAX_SHOTS, captureScenePng, screenshotWhenSettled} from './visual/lib/harness.mjs';

function fakeBrowser(frames) {
  const log = {shots: 0, rafWaits: 0, closed: 0};
  let i = 0;
  const page = {
    on() {},
    async goto() {},
    async evaluate(fn) {
      // openScenePage 的就绪等待与 screenshotWhenSettled 的两帧等待都走这里
      if (String(fn).includes('requestAnimationFrame') && !String(fn).includes('document.fonts')) log.rafWaits += 1;
    },
    async screenshot(opts) {
      assert.equal(opts?.type, 'png');
      log.shots += 1;
      const frame = frames[Math.min(i, frames.length - 1)];
      i += 1;
      return Buffer.from(frame);
    },
  };
  const context = {
    async addInitScript() {},
    async newPage() { return page; },
    async close() { log.closed += 1; },
  };
  return {browser: {async newContext() { return context; }}, page, log};
}

test('B62：前两张还没画完（6 px 那种差），交出的是停下来之后的画面', async () => {
  const {browser, log} = fakeBrowser(['partial-1', 'settled', 'settled']);
  const {png, pageErrors} = await captureScenePng(browser, 'http://127.0.0.1:1', 'home-learning', 'day');
  assert.equal(png.toString(), 'settled');
  assert.deepEqual(pageErrors, []);
  assert.equal(log.shots, 3);
  assert.equal(log.closed, 1);
});

test('B62：同一场景连拍两次，即使第一次的首帧没画完，两次结果也逐字节相同', async () => {
  const a = fakeBrowser(['partial-a', 'final', 'final']);
  const b = fakeBrowser(['final', 'final']);
  const first = await captureScenePng(a.browser, 'http://127.0.0.1:1', 'sidebar-collapsed', 'night');
  const second = await captureScenePng(b.browser, 'http://127.0.0.1:1', 'sidebar-collapsed', 'night');
  assert.equal(Buffer.compare(first.png, second.png), 0);
});

test('B62：已经稳定的页面只多拍一张，结果与原来的单张截图相同', async () => {
  const {browser, log} = fakeBrowser(['stable']);
  const {png} = await captureScenePng(browser, 'http://127.0.0.1:1', 'study-desk', 'day');
  assert.equal(png.toString(), 'stable');
  assert.equal(log.shots, 2);
});

test('B62：画面一直在变就报错，不交出没画完的截图，也不无限等', async () => {
  const frames = Array.from({length: SETTLE_MAX_SHOTS + 4}, (_, k) => `frame-${k}`);
  const {browser, log} = fakeBrowser(frames);
  await assert.rejects(
    captureScenePng(browser, 'http://127.0.0.1:1', 'model-picker', 'day'),
    /model-picker-day never settled: 8 screenshots taken 2 frames apart/,
  );
  assert.equal(log.shots, SETTLE_MAX_SHOTS);
  assert.equal(log.closed, 1, 'context 仍要关掉');
});

test('B62：每两张之间都隔两帧再拍', async () => {
  const {page, log} = fakeBrowser(['x', 'y', 'y']);
  const png = await screenshotWhenSettled(page, {label: 'probe'});
  assert.equal(png.toString(), 'y');
  assert.equal(log.shots, 3);
  assert.equal(log.rafWaits, 2);
});
