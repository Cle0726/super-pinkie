// B51：visual-baseline 重复渲染断言失败时的诊断。CI Linux 上偶尔「run 1 vs run N 差 6–8 px」，
// 测试只报像素数、不存图，没人知道差在哪。这里锁住失败信息里补的东西：场景 / 主题、哪两次、
// 图尺寸、差异像素包围框、最大通道差。只拼信息，不改判定、不加容差。
import assert from 'node:assert/strict';
import test from 'node:test';
import {comparePng, describeRepeatDiff, encodePng} from './visual/lib/png-diff.mjs';

const W = 8;
const H = 6;

// 纯色小图；edits = [[x, y, 红通道减多少], …]
function png(edits = []) {
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i += 1) {
    rgba[i * 4] = 200;
    rgba[i * 4 + 1] = 180;
    rgba[i * 4 + 2] = 190;
    rgba[i * 4 + 3] = 255;
  }
  for (const [x, y, d] of edits) rgba[(y * W + x) * 4] -= d;
  return encodePng(W, H, rgba);
}

test('两次渲染一样：0 px，没有包围框，最大通道差 0', () => {
  const d = comparePng(png(), png(), {channelTolerance: 0});
  assert.equal(d.diffPixels, 0);
  assert.equal(d.box, null);
  assert.equal(d.maxDelta, 0);
  assert.equal(
    describeRepeatDiff({scene: 'home-chat', theme: 'day', runA: 1, runB: 2}, d),
    'home-chat-day non-deterministic render: run 1 vs run 2 differed by 0 px (0.0000%); '
      + 'scene=home-chat theme=day; size 8x6; box none; max channel Δ0',
  );
});

test('已知差两个像素：包围框、最大通道差对得上，开头和原来的失败信息一字不差', () => {
  const d = comparePng(png(), png([[2, 1, 6], [5, 3, 3]]), {channelTolerance: 0});
  assert.equal(d.diffPixels, 2);
  assert.deepEqual(d.box, {x0: 2, y0: 1, x1: 5, y1: 3});
  assert.equal(d.maxDelta, 6);
  const msg = describeRepeatDiff({scene: 'model-picker', theme: 'day', runA: 1, runB: 3}, d);
  assert.match(msg, /^model-picker-day non-deterministic render: run 1 vs run 3 differed by 2 px \(4\.1667%\); /);
  assert.match(msg, /; scene=model-picker theme=day; size 8x6; box x=2\.\.5 y=1\.\.3 \(4x3\); max channel Δ6$/);
});

test('判定不变：默认容差 10 下这两处不算差，但最大通道差照样记 6', () => {
  const d = comparePng(png(), png([[2, 1, 6], [5, 3, 3]]));
  assert.equal(d.diffPixels, 0);
  assert.equal(d.box, null);
  assert.equal(d.maxDelta, 6);
});
