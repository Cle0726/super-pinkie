#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

// 下载到临时文件，完整校验后才放到目标位置。源不可用、超时或哈希不符时换下一个源。
export async function downloadVerified({urls, target, integrity, maxBytes, idleMs = 20_000, allowLoopback = false}) {
  const [algorithm, expected] = String(integrity || '').split('-', 2);
  if (!['sha256', 'sha512'].includes(algorithm) || !expected || !Array.isArray(urls) || !urls.length || !(maxBytes > 0)) throw new Error('下载清单不完整');
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const temp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.part`;
  const errors = [];
  for (const source of urls) {
    let handle;
    let timer;
    const controller = new AbortController();
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), idleMs); };
    try {
      const parsed = new URL(source);
      let current = parsed;
      let response;
      for (let redirects = 0; redirects <= 5; redirects++) {
        if (current.protocol !== 'https:' && !(allowLoopback && current.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(current.hostname))) throw new Error('下载地址不安全');
        reset();
        response = await fetch(current, {signal: controller.signal, redirect: 'manual'});
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location');
        if (!location || redirects === 5) throw new Error('下载跳转过多');
        current = new URL(location, current);
      }
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      handle = fs.openSync(temp, 'wx');
      const digest = crypto.createHash(algorithm);
      let bytes = 0;
      for await (const chunk of response.body) {
        reset(); bytes += chunk.length;
        if (bytes > maxBytes) throw new Error('下载文件超出清单大小');
        digest.update(chunk);
        let offset = 0;
        while (offset < chunk.length) offset += fs.writeSync(handle, chunk, offset, chunk.length - offset);
      }
      fs.closeSync(handle); handle = undefined;
      if (digest.digest('base64') !== expected) throw new Error('文件校验失败');
      fs.renameSync(temp, target);
      return {ok: true, bytes, source: parsed.host};
    } catch (error) {
      errors.push(error.name === 'AbortError' ? '连接超时' : String(error.message || error));
    } finally {
      clearTimeout(timer);
      if (handle !== undefined) fs.closeSync(handle);
      fs.rmSync(temp, {force: true});
    }
  }
  return {ok: false, note: `所有下载源都没成功：${errors.join('；')}`};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = JSON.parse(process.argv[2] || '{}');
    const result = await downloadVerified(options);
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  } catch (error) { console.log(JSON.stringify({ok: false, note: String(error.message || error)})); process.exitCode = 1; }
}
