#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

// 下载到临时文件，完整校验后才放到目标位置。源不可用、超时或哈希不符时换下一个源。
export async function downloadVerified({urls, target, integrity, maxBytes, idleMs = 20_000, allowLoopback = false, attempts = 3}) {
  const [algorithm, expected] = String(integrity || '').split('-', 2);
  if (!['sha256', 'sha512'].includes(algorithm) || !expected || !Array.isArray(urls) || !urls.length || !(maxBytes > 0)) throw new Error('下载清单不完整');
  fs.mkdirSync(path.dirname(target), {recursive: true});
  // 固定的半成品文件：断线后下次接着下（服务器支持 Range 时），不从零开始。整个文件下完再统一校验。
  const temp = `${target}.part`;
  const errors = [];
  for (const source of urls) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      let handle;
      let timer;
      const controller = new AbortController();
      const reset = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), idleMs); };
      try {
        const parsed = new URL(source);
        let current = parsed;
        let response;
        const have = fs.existsSync(temp) ? fs.statSync(temp).size : 0;
        for (let redirects = 0; redirects <= 5; redirects++) {
          if (current.protocol !== 'https:' && !(allowLoopback && current.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(current.hostname))) throw new Error('下载地址不安全');
          reset();
          response = await fetch(current, {signal: controller.signal, redirect: 'manual', headers: have ? {Range: `bytes=${have}-`} : {}});
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          const location = response.headers.get('location');
          if (!location || redirects === 5) throw new Error('下载跳转过多');
          current = new URL(location, current);
        }
        if (response.status === 416) { fs.rmSync(temp, {force: true}); throw new Error('续传位置无效，重新下载'); }
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        const resume = response.status === 206 && have > 0;
        const digest = crypto.createHash(algorithm);
        let bytes = 0;
        if (resume) { digest.update(fs.readFileSync(temp)); bytes = have; }
        handle = fs.openSync(temp, resume ? 'a' : 'w');
        for await (const chunk of response.body) {
          reset(); bytes += chunk.length;
          if (bytes > maxBytes) { fs.closeSync(handle); handle = undefined; fs.rmSync(temp, {force: true}); throw new Error('下载文件超出清单大小'); }
          digest.update(chunk);
          let offset = 0;
          while (offset < chunk.length) offset += fs.writeSync(handle, chunk, offset, chunk.length - offset);
        }
        fs.closeSync(handle); handle = undefined;
        if (digest.digest('base64') !== expected) { fs.rmSync(temp, {force: true}); throw new Error('文件校验失败'); }
        fs.renameSync(temp, target);
        return {ok: true, bytes, source: parsed.host, resumed: resume};
      } catch (error) {
        const message = error.name === 'AbortError' ? '连接超时' : String(error.message || error);
        errors.push(message);
        // 只有断线、超时这类才在同一个源上接着续；404、校验失败、地址不安全直接换下一个源。
        if (!/连接超时|terminated|ECONNRESET|socket|fetch failed|other side closed/i.test(message)) break;
      } finally {
        clearTimeout(timer);
        if (handle !== undefined) fs.closeSync(handle);
      }
    }
  }
  return {ok: false, note: `所有下载源都没成功：${[...new Set(errors)].join('；')}`};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = JSON.parse(process.argv[2] || '{}');
    const result = await downloadVerified(options);
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  } catch (error) { console.log(JSON.stringify({ok: false, note: String(error.message || error)})); process.exitCode = 1; }
}
