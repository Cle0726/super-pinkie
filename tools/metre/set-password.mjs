#!/usr/bin/env node
// 生成正式版 Metre 开发者密码的慢哈希（Node 自带 crypto.scrypt + 随机盐）。
// 只把哈希写进 services/mode-architecture/metre-lock-hash.json（在签名清单里）；明文密码不落盘、不打印、不进仓库。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_HASH_FILE = path.resolve(HERE, '../../services/mode-architecture/metre-lock-hash.json');
export const SCRYPT_PARAMS = Object.freeze({N: 32768, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024});

export function hashPassword(password, {
  salt = crypto.randomBytes(32).toString('hex'),
  N = SCRYPT_PARAMS.N,
  r = SCRYPT_PARAMS.r,
  p = SCRYPT_PARAMS.p,
  keylen = SCRYPT_PARAMS.keylen,
  maxmem = SCRYPT_PARAMS.maxmem,
} = {}) {
  const normalized = String(password ?? '').normalize('NFC');
  if (!normalized) throw new Error('密码不能为空');
  return new Promise((resolve, reject) => {
    crypto.scrypt(Buffer.from(normalized, 'utf8'), Buffer.from(salt, 'hex'), keylen, {N, r, p, maxmem}, (err, derived) => {
      if (err) return reject(err);
      resolve({
        algorithm: 'scrypt',
        configured: true,
        N,
        r,
        p,
        keylen,
        salt,
        hash: derived.toString('hex'),
        updatedAt: new Date().toISOString(),
      });
    });
  });
}

export async function writePasswordHash(password, {outFile = DEFAULT_HASH_FILE, ...params} = {}) {
  const record = await hashPassword(password, params);
  fs.mkdirSync(path.dirname(outFile), {recursive: true});
  const tmp = `${outFile}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n', {mode: 0o644});
  fs.renameSync(tmp, outFile);
  return {outFile, record};
}

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error('请在交互式终端里运行此脚本以隐藏输入密码'));
    const stdout = process.stdout;
    const stdin = process.stdin;
    stdout.write(question);
    const wasRaw = Boolean(stdin.isRaw);
    stdin.setRawMode(true);
    stdin.resume();
    let value = '';
    const cleanup = () => {
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdin.removeListener('data', onData);
    };
    const onData = (chunk) => {
      const text = chunk.toString('utf8');
      for (const ch of text) {
        if (ch === '\r' || ch === '\n') {
          cleanup();
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          cleanup();
          stdout.write('\n');
          reject(new Error('已取消'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          if (value.length > 0) value = [...value].slice(0, -1).join('');
          continue;
        }
        if (ch >= ' ' || ch === '\t') value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

function promptLine(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({input: process.stdin, output: process.stdout});
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

async function runCli(argv = process.argv.slice(2)) {
  const outIndex = argv.indexOf('--out');
  const outFile = outIndex >= 0 && argv[outIndex + 1] ? path.resolve(argv[outIndex + 1]) : DEFAULT_HASH_FILE;
  if (argv.some(a => a.startsWith('--password'))) {
    console.error('为了安全，不支持把密码写在命令行参数里。请直接运行 node tools/metre/set-password.mjs 按提示输入。');
    process.exit(2);
  }
  console.log('设置正式版 Metre 开发者密码（输入内容不会显示在屏幕上）。');
  console.log('至少 6 位；字母和数字混着用更难被猜到。\n');
  const first = (await promptHidden('请输入新密码：')).normalize('NFC');
  if ([...first].length < 6) {
    console.error('密码至少需要 6 个字符。');
    process.exit(1);
  }
  if (/^\d+$/.test(first)) {
    console.log('提示：纯数字密码比较好猜，混入字母会更安全（仍可继续使用）。');
  }
  const second = (await promptHidden('请再输入一次确认：')).normalize('NFC');
  if (first !== second) {
    console.error('两次输入的密码不一致，未写入任何文件。');
    process.exit(1);
  }
  await writePasswordHash(first, {outFile});
  console.log(`\n已写入哈希文件：${path.relative(process.cwd(), outFile) || outFile}`);
  console.log('下一步：把这份文件提交到仓库（git add services/mode-architecture/metre-lock-hash.json && git commit），切勿把明文密码写进代码、提交说明或聊天里。');
}

const isMain = (() => {
  try { return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (isMain) {
  runCli().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
