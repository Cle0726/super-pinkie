#!/usr/bin/env node
// 外部引擎当 Metre 主脑时，在它自己的终端里跑这个来派活（服务端：engines-dispatch.mjs）。
// 用法：node engines-dispatch-cli.mjs --url http://127.0.0.1:<端口>/dispatch --token <令牌> < 请求.json
//   也可以把 JSON 直接写在最后一个参数里：... --token <令牌> '{"action":"list"}'
// 只往 127.0.0.1 发；结果原样打印成 JSON，出错时退出码 1。
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] || '' : ''; };
const url = flag('--url'), token = flag('--token');
const fail = message => { process.stdout.write(JSON.stringify({ok: false, error: message}) + '\n'); process.exit(1); };

let target;
try { target = new URL(url); } catch { fail('--url 写派活说明里给的地址'); }
if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1') fail('只能发到本机 127.0.0.1');
if (!token) fail('--token 写派活说明里给的令牌');

async function input() {
  if (args.length) return args.join(' ');
  if (process.stdin.isTTY) fail('把请求 JSON 从标准输入给，或者写在最后一个参数里');
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const raw = (await input()).replace(/^﻿/, '').trim();
let body;
try { body = JSON.parse(raw || '{}'); } catch { fail('请求不是合法的 JSON'); }
try {
  const response = await fetch(target, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${token}`}, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000)});
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); } catch { fail(`服务回的不是 JSON（HTTP ${response.status}）`); }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(result?.ok === false ? 1 : 0);
} catch (error) {
  fail(`连不上碧琪的派活服务：${error?.message || error}（碧琪关了外部引擎，或者重启过；在 Metre 里再说一句会发新的说明）`);
}
