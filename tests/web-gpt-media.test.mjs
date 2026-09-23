import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {prepareMediaBatch} from '../services/chatgpt-collab/runtime/dist/workspace/media.js';

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL0eQAAAABJRU5ErkJggg==',
  'base64',
);

test('selected media batch returns only the named image as inline visual content', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-web-gpt-media-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const image = path.join(root, 'diagram.png');
  fs.writeFileSync(image, onePixelPng);
  const workspace = {
    resolve(requested) {
      const abs = path.resolve(root, requested);
      if (abs !== image) throw new Error('outside fixture');
      return {abs, rel: requested};
    },
  };
  const result = await prepareMediaBatch(workspace, ['diagram.png']);
  assert.equal(result.source, 'explicit-user-selected-media');
  assert.deepEqual(result.items.map(item => item.path), ['diagram.png']);
  assert.equal(result.items[0].kind, 'image');
  assert.equal(result.visuals.length, 1);
  assert.equal(result.visuals[0].type, 'image');
  assert.equal(result.visuals[0].mimeType, 'image/png');
  assert.ok(result.visuals[0].data.length > 20);
});

test('media batch rejects a file that was not explicitly selected', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-web-gpt-media-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.writeFileSync(path.join(root, 'note.txt'), 'not media');
  const workspace = { resolve: requested => ({abs: path.join(root, requested), rel: requested}) };
  await assert.rejects(() => prepareMediaBatch(workspace, ['note.txt']), /仅支持/);
});

test('video stays local while evenly-spaced JPEG keyframes are prepared', async t => {
  if (spawnSync('ffmpeg', ['-version'], {stdio: 'ignore'}).status !== 0) {
    t.skip('ffmpeg is not installed in this test environment');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-web-gpt-media-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const video = path.join(root, 'clip.mp4');
  const made = spawnSync('ffmpeg', [
    '-v', 'error', '-f', 'lavfi', '-i', 'color=c=purple:s=96x64:d=2',
    '-pix_fmt', 'yuv420p', '-y', video,
  ], {encoding: 'utf8'});
  assert.equal(made.status, 0, made.stderr);
  const workspace = { resolve: requested => ({abs: path.join(root, requested), rel: requested}) };
  const result = await prepareMediaBatch(workspace, ['clip.mp4'], {videoFrames: 2});
  assert.equal(result.items[0].kind, 'video-keyframes');
  assert.equal(result.items[0].frameCount, 2);
  assert.equal(result.items[0].hasAudio, false);
  assert.equal(result.visuals.length, 2);
  assert.ok(result.visuals.every(visual => visual.mimeType === 'image/jpeg'));
});
