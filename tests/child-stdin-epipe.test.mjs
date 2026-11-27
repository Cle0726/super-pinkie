import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {Writable} from 'node:stream';

// 往子进程 stdin 写数据、子进程没读完就退出（backlog P2 同类：没人接的错误把网关打崩）。
// 管道对端关了，写入在 stdin 流上发 'error'（POSIX 是 EPIPE，Windows 是 EOF / EPIPE）。
// child.on('error') 接不到这个：它只管起进程失败。stdin 上没挂 'error' 就成了 uncaughtException，
// 网关整个进程退出。三处：engines.mjs runProcess、workbench-ext.mjs formatText、workbench-lsp.mjs LspHub.send。
// learning-compute.mjs / learning-materials-extract.mjs / workbench.mjs 早就挂了 stdin 'error'，这里补齐另外三处。
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-stdin-epipe-'));
process.env.PINKIE_STATE_ROOT = path.join(ROOT, 'state');
process.on('exit', () => fs.rmSync(ROOT, {recursive: true, force: true}));

const {runProcess} = await import('../services/mode-architecture/engines.mjs');
const {formatText, LSP_DIR} = await import('../services/mode-architecture/workbench-ext.mjs');
const {LspHub} = await import('../services/mode-architecture/workbench-lsp.mjs');

// 8 MB 远大于管道缓冲（Linux 64 KB、Windows 更小），子进程不读就退出时写入必然失败。
const BIG = 'x'.repeat(8 * 1024 * 1024);

async function catchUncaught(run) {
  const seen = [];
  const onUncaught = error => seen.push(error);
  process.on('uncaughtException', onUncaught);
  try {
    const value = await run();
    // 写入失败的 'error' 可能晚于子进程 close 一两拍才到。
    await new Promise(resolve => setTimeout(resolve, 300));
    return {value, seen};
  } finally {
    process.off('uncaughtException', onUncaught);
  }
}

const describeErrors = errors => errors.map(e => `${e?.code || ''} ${e?.message || e}`).join('; ');

test('runProcess：子进程不读 stdin 就退出时照常返回退出码，不留 uncaughtException', async () => {
  const {value, seen} = await catchUncaught(() =>
    runProcess(process.execPath, ['-e', 'process.exit(3)'], {input: BIG, timeout: 20_000}));
  assert.deepEqual(seen, [], `stdin 写入错误没人接：${describeErrors(seen)}`);
  assert.equal(value.code, 3);
});

test('runProcess：子进程读完 stdin 的正常路径不变', async () => {
  const {value, seen} = await catchUncaught(() =>
    runProcess(process.execPath, ['-e', "let n=0;process.stdin.on('data',c=>n+=c.length).on('end',()=>{process.stdout.write(String(n))})"], {input: 'hello', timeout: 20_000}));
  assert.deepEqual(seen, []);
  assert.equal(value.code, 0);
  assert.equal(value.stdout, '5');
});

// formatText 按文件名在 LSP_DIR/bin 里找格式化程序，再用 execFile 起它；Windows 起不了无扩展名的脚本，只在 POSIX 跑。
test('formatText：格式化程序不读 stdin 就退出时只拒绝这一次，不留 uncaughtException', {skip: process.platform === 'win32' && '要 /bin/sh 脚本当格式化程序'}, async () => {
  const bin = path.join(LSP_DIR, 'bin');
  fs.mkdirSync(bin, {recursive: true});
  const gofmt = path.join(bin, 'gofmt');
  fs.writeFileSync(gofmt, '#!/bin/sh\necho "boom" >&2\nexit 3\n');
  fs.chmodSync(gofmt, 0o755);
  try {
    const {value, seen} = await catchUncaught(() =>
      formatText({language: 'go', content: BIG, filePath: path.join(ROOT, 'a.go'), cwd: ROOT}).then(
        text => ({ok: true, text}),
        error => ({ok: false, error})));
    assert.deepEqual(seen, [], `stdin 写入错误没人接：${describeErrors(seen)}`);
    assert.equal(value.ok, false);
    assert.match(String(value.error.message), /gofmt 格式化失败/);
  } finally {
    fs.rmSync(gofmt, {force: true});
  }
});

function fakeLspChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  // 语言服务已经挂了、管道对端关了：每次写都在流上报 EPIPE。
  child.stdin = new Writable({
    write(chunk, encoding, callback) {
      const error = new Error('write EPIPE');
      error.code = 'EPIPE';
      callback(error);
    },
  });
  child.kill = () => {};
  return child;
}

test('LspHub.send：语言服务管道已断时写入失败不留 uncaughtException', async () => {
  const bin = path.join(LSP_DIR, 'bin');
  fs.mkdirSync(bin, {recursive: true});
  // 只要 which() 认得到；spawn 是桩，不真起。
  const server = path.join(bin, 'pyright-langserver');
  fs.writeFileSync(server, '#!/bin/sh\n');
  fs.chmodSync(server, 0o755);
  const hub = new LspHub({spawn: () => fakeLspChild()});
  try {
    const started = hub.start({connId: 'c1', root: ROOT, language: 'python', emit: () => {}});
    assert.equal(started.available, true, JSON.stringify(started));
    const {seen} = await catchUncaught(async () => hub.send(started.id, {jsonrpc: '2.0', id: 1, method: 'initialize', params: {}}));
    assert.deepEqual(seen, [], `stdin 写入错误没人接：${describeErrors(seen)}`);
  } finally {
    clearInterval(hub.sweeper);
    fs.rmSync(server, {force: true});
  }
});
