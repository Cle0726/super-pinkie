// B86：证据探测（sips / ffprobe）跑不起来、超时、退出码非 0 时，报错要说清是工具的问题并带上 stderr，
// 不能只剩一句「无法解码」把锅甩给文件。不起真进程，用假的 spawnSync 结果。
import test from 'node:test';
import assert from 'node:assert/strict';
import {probeImageFile, probeVideoFile} from '../services/mode-architecture/evidence-rules.mjs';

const gone = code => () => ({status: null, stdout: '', stderr: '', error: Object.assign(new Error(`spawnSync x ${code}`), {code})});

test('B86: a probe tool that exits non-zero keeps its stderr in the error', () => {
  const run = () => ({status: 1, stdout: '', stderr: 'Error 13: an unknown error occurred\n'});
  assert.throws(() => probeImageFile('/tmp/a.png', {run}), error => /图片无法解码：\/tmp\/a\.png/.test(error.message)
    && /sips 退出码 1/.test(error.message) && /unknown error occurred/.test(error.message));
  const ffprobe = () => ({status: 1, stdout: '', stderr: '/tmp/a.mp4: Invalid data found when processing input\n'});
  assert.throws(() => probeVideoFile('/tmp/a.mp4', {run: ffprobe}), error => /视频无法解析/.test(error.message)
    && /ffprobe 退出码 1/.test(error.message) && /Invalid data found/.test(error.message));
});

test('B86: a probe tool that is missing or times out says so instead of blaming the file', () => {
  assert.throws(() => probeImageFile('/tmp/a.png', {run: gone('ENOENT')}), /本机没有 sips/);
  assert.throws(() => probeVideoFile('/tmp/a.mp4', {run: gone('ENOENT')}), /本机没有 ffprobe/);
  assert.throws(() => probeVideoFile('/tmp/a.mp4', {run: gone('ETIMEDOUT')}), /ffprobe 超时/);
});

test('B86: a probe killed by a signal names the signal, not "exit code null"', () => {
  const run = () => ({status: null, signal: 'SIGKILL', stdout: '', stderr: ''});
  assert.throws(() => probeVideoFile('/tmp/a.mp4', {run}), error => /ffprobe 退出码 SIGKILL/.test(error.message) && !/null/.test(error.message));
});

test('a successful ffprobe still returns the parsed streams', () => {
  const data = {format: {duration: '3.2'}, streams: [{codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920}, {codec_type: 'audio'}]};
  const result = probeVideoFile('/tmp/a.mp4', {run: () => ({status: 0, stdout: JSON.stringify(data), stderr: ''})});
  assert.equal(result.video.codec_name, 'h264');
  assert.equal(result.audio.codec_type, 'audio');
});
