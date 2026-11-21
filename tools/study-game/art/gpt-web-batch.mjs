// ChatGPT 网页版并发出图（专用 Chrome，CDP 9333，已登录）。每个任务一个新标签页 + 新对话，N 个标签页同时跑。
// 用法：node tools/study-game/art/gpt-web-batch.mjs <jobs.json> [--parallel=4] [--retries=2]
// jobs.json: [{"out": "绝对路径.png", "prompt": "...", "refs": ["参考图绝对路径", ...]}]；out 已存在的跳过。
// 页面操作照 慢半拍/工具/gpt_web_gen.mjs（上传参考图 → 发提示 → 等「已生成图像」稳定 → 页内 fetch 原图）。
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => args.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const jobsFile = args.find(a => !a.startsWith('--'));
if (!jobsFile) { console.error('用法: node gpt-web-batch.mjs <jobs.json> [--parallel=4]'); process.exit(1); }
const PORT = Number(opt('port', 9333)), PARALLEL = Number(opt('parallel', 4)), RETRIES = Number(opt('retries', 2));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function openTab() {
  const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?https://chatgpt.com/`, {method: 'PUT'})).json();
  const ws = new WebSocket(tgt.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); const p = pend.get(m.id); if (p) { pend.delete(m.id); p(m); } };
  const call = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({id: i, method, params})); });
  const ev = async x => { const r = await call('Runtime.evaluate', {expression: x, returnByValue: true, awaitPromise: true}); return r.result?.result?.value; };
  const close = async () => { try { ws.close(); } catch { /* 无 */ } try { await fetch(`http://127.0.0.1:${PORT}/json/close/${tgt.id}`); } catch { /* 无 */ } };
  return {call, ev, close, id: tgt.id};
}

async function one(job, tag) {
  const tab = await openTab();
  const {call, ev} = tab;
  try {
    await call('Page.enable');
    await sleep(7000);
    for (let k = 0; k < 12; k++) {
      const n = await ev(`(() => { const bs = [...document.querySelectorAll('button[aria-label^="移除"], button[aria-label^="Remove"]')]; bs.forEach(b => b.click()); return bs.length; })()`);
      if (!n) break; await sleep(500);
    }
    const key = async (k, code, vk, mod = 0) => { for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', {type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mod}); };
    const focusBox = () => ev(`(() => { const e = document.querySelector('#prompt-textarea, [contenteditable=true].ProseMirror, div[contenteditable=true]'); if (!e) return false; e.focus(); return true; })()`);
    // 清掉账号里留着的草稿（ProseMirror：全选 + 退格）
    if (await focusBox()) { await key('a', 'KeyA', 65, 2); await key('Backspace', 'Backspace', 8); await sleep(400); }
    const refs = (job.refs || []).map(r => path.resolve(r));
    if (refs.length) {
      // 直接拿「image/* + multiple」那个 input 的对象句柄（整棵 DOM 用 getDocument 取会卡住）
      // 页面慢的时候上传入口要等一会儿才出现：最多等 40 秒（以前只看一眼，三次都扑空就整张失败）
      let objectId = null;
      for (let k = 0; k < 30 && !objectId; k++) {
        const h = await call('Runtime.evaluate', {expression: `(() => { const all = [...document.querySelectorAll('input[type=file]')]; return all.find(i => i.multiple && i.accept === 'image/*') || all.find(i => i.multiple) || all.pop(); })()`});
        objectId = h.result?.result?.objectId || null; if (!objectId) await sleep(2000);
      }
      if (!objectId) {
        const why = await ev(`document.title.slice(0, 80)`);
        throw new Error('找不到上传入口：' + (why || '页面没加载'));
      }
      await call('DOM.setFileInputFiles', {files: refs, objectId});
      for (let i = 0; i < 60; i++) {
        await sleep(1000);
        const n = await ev(`document.querySelectorAll('form img, [data-testid*=attachment] img, div[class*=attachment] img, [class*=composer] img').length`);
        const busy = await ev(`!!document.querySelector('[role=progressbar], circle[stroke-dasharray]')`);
        if (n >= refs.length && !busy) break;
      }
      await sleep(1500);
    }
    const ok = await focusBox();
    if (!ok) throw new Error('找不到输入框（登录过期？）');
    // 并发时几个标签页共用账号的输入框草稿，会把别的标签页刚打的提示词同步过来（出过「海盗的空镜画成了海盗的欢呼姿势」）。
    // 发送前核对输入框里就是这一张的提示词，不是就清掉重打；发出去以后再核对一次对话里的那条消息。
    const norm = t => String(t || '').replace(/\s+/g, ' ').trim();
    const want = norm(job.prompt);
    const boxText = () => ev(`(() => { const e = document.querySelector('#prompt-textarea, [contenteditable=true].ProseMirror, div[contenteditable=true]'); return e ? (e.innerText || e.value || '') : ''; })()`);
    let typed = false;
    for (let k = 0; k < 4 && !typed; k++) {
      await call('Input.insertText', {text: job.prompt});
      await sleep(900 + k * 600);
      typed = norm(await boxText()) === want;
      if (!typed) { await focusBox(); await key('a', 'KeyA', 65, 2); await key('Backspace', 'Backspace', 8); await sleep(500); }
    }
    if (!typed) throw new Error('输入框里的提示词对不上（草稿被别的标签页改了）');
    let sent = false;
    for (let i = 0; i < 40 && !sent; i++) {
      sent = await ev(`(() => { const b = document.querySelector('[data-testid=send-button]:not([disabled]), button[aria-label="发送"]:not([disabled]), button[aria-label="发送提示"]:not([disabled]), button[aria-label="Send prompt"]:not([disabled])'); if (!b) return false; b.scrollIntoView({block: 'center'}); b.click(); return true; })()`);
      if (!sent) await sleep(1000);
    }
    if (!sent) throw new Error('发送按钮一直不可用');
    log(tag, '已发送');
    {
      let mine = '';
      for (let i = 0; i < 20 && !mine; i++) { await sleep(1000); mine = norm(await ev(`(() => { const r = [...document.querySelectorAll('[data-message-author-role=user]')].pop(); return r ? r.innerText : ''; })()`)); }
      if (mine && mine !== want && !mine.includes(want)) throw new Error('发出去的提示词不是这一张的（草稿串了），重来');
    }
    let src = null, stable = 0, last = null;
    for (let i = 0; i < 220; i++) {
      await sleep(3000);
      const s = await ev(`(() => { const imgs = [...document.querySelectorAll('img[alt^="已生成图像"], img[alt^="Generated image"], img[alt*="生成的图"]')].filter(im => im.naturalWidth > 600); const im = imgs.pop(); return im ? im.src + '|' + im.naturalWidth : null; })()`);
      const stillGen = await ev(`/正在创建|正在生成|Creating image|Generating/.test(document.body.innerText)`);
      if (s && !stillGen) { if (s === last) stable++; else stable = 0; last = s; if (stable >= 2) { src = s.split('|')[0]; break; } }
      const reply = await ev(`(() => { const r = [...document.querySelectorAll('[data-message-author-role=assistant]')].pop(); return r ? r.innerText.slice(0, 300) : ''; })()`);
      if (i > 20 && reply && !s && !stillGen && /无法|不能|抱歉|违反|can't|unable|policy/i.test(reply)) throw new Error('被拒绝：' + reply.slice(0, 120));
      if (i > 12 && /限制|上限|limit|too quickly|稍后/i.test(reply || '') && !s) throw new Error('额度/限速：' + reply.slice(0, 120));
      if (i > 15 && reply && !s && !stillGen && /上传参考|参考图|reference image|upload/i.test(reply)) throw new Error('参考图没挂上：' + reply.slice(0, 80));
      // 成功的一张大约一两分钟就落下来。页面既没有图、也不在生成，就早点重试，不要干等 11 分钟。
      if (i > 45 && !s && !stillGen) throw new Error('两分多钟还没开始出图');
    }
    if (!src) throw new Error('等不到图（超时）');
    const b64 = await ev(`(async () => { const r = await fetch(${JSON.stringify(src)}, {credentials: 'include'}); const b = new Uint8Array(await r.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); })()`);
    if (!b64) throw new Error('下载失败');
    fs.mkdirSync(path.dirname(job.out), {recursive: true});
    fs.writeFileSync(job.out, Buffer.from(b64, 'base64'));
    log(tag, 'OK', job.out);
    return true;
  } finally { await tab.close(); }
}

const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8')).filter(j => !fs.existsSync(j.out));
log(`待出 ${jobs.length} 张，并发 ${PARALLEL}`);
let next = 0; const failed = [];
async function worker(w) {
  await sleep(w * 2500);
  while (next < jobs.length) {
    const job = jobs[next++]; const tag = `[${path.basename(job.out)}]`;
    let done = false;
    for (let t = 0; t <= RETRIES && !done; t++) {
      try { done = await one(job, tag); }
      catch (e) { log(tag, `第 ${t + 1} 次失败：`, e.message); if (/额度|限速/.test(e.message)) await sleep(90000); else await sleep(5000); }
    }
    if (!done) failed.push(job.out);
  }
}
await Promise.all(Array.from({length: Math.min(PARALLEL, jobs.length)}, (_, w) => worker(w)));
log('完成', {failed});
process.exit(failed.length ? 2 : 0);
