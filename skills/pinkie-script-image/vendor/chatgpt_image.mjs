// ChatGPT 网页版出图（专用 Chrome，CDP 9333）。适配 2026-11 新版界面（textarea#pending-home-input）。
// 用法: node chatgpt_image.mjs "<提示词>" --out <输出.png> [--ref 图1 --ref 图2 ...] [--n 2]
const argv = process.argv.slice(2);
const prompt = argv[0];
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const out = opt('--out');
const N = Number(opt('--n') || 1);
const refs = argv.flatMap((a, i) => (a === '--ref' ? [argv[i + 1]] : [])).filter(Boolean);
if (!prompt || !out) {
  console.error('用法: node chatgpt_image.mjs "<提示词>" --out <输出.png> [--ref 图...] [--n 2]');
  process.exit(1);
}
const PORT = process.env.CDP_PORT || '9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
let tgt = targets.find((t) => t.type === 'page' && /chatgpt\.com/.test(t.url));
if (!tgt) tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?https://chatgpt.com/`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pend = {};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
};
const call = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => {
  const r = await call('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  return r.result && r.result.result ? r.result.result.value : undefined;
};
const clickAt = async ({ x, y }) => {
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  for (const type of ['mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
};

// 找输入框：新版是 textarea（#prompt-textarea 或 #pending-home-input 或最后一个可见 textarea），旧版是 contenteditable
const FIND_INPUT = `(() => {
  const cands = [];
  for (const id of ['prompt-textarea', 'pending-home-input']) { const e = document.getElementById(id); if (e) cands.push(e); }
  document.querySelectorAll('textarea').forEach(e => cands.push(e));
  document.querySelectorAll('[contenteditable="true"], [role="textbox"]').forEach(e => cands.push(e));
  for (const e of cands) {
    const b = e.getBoundingClientRect();
    if (b.width > 120 && b.height > 10) return e;
  }
  return null;
})()`;

async function one(outPath) {
  await call('Page.enable');
  await call('Page.navigate', { url: 'https://chatgpt.com/' });
  // 等输入框真的出现（最多 45 秒）
  let ready = false;
  for (let i = 0; i < 45; i++) {
    await sleep(1000);
    ready = await ev(`!!${FIND_INPUT}`);
    if (ready) break;
  }
  if (!ready) throw new Error('等不到输入框（登录过期或页面没加载）');

  // 清掉上次的草稿和附件
  for (let k = 0; k < 12; k++) {
    const n = await ev(`(() => { const bs = [...document.querySelectorAll('button[aria-label^="移除"], button[aria-label^="Remove"]')]; bs.forEach(b => b.click()); return bs.length; })()`);
    if (!n) break;
    await sleep(400);
  }
  await ev(`(() => {
    const e = ${FIND_INPUT}; if (!e) return;
    e.focus();
    if (e.tagName === 'TEXTAREA') {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      set.call(e, '');
      e.dispatchEvent(new Event('input', {bubbles: true}));
    } else {
      document.execCommand('selectAll'); document.execCommand('delete');
    }
  })()`);

  // 参考图
  if (refs.length) {
    await call('DOM.enable');
    const doc = await call('DOM.getDocument', { depth: -1, pierce: true });
    const q = await call('DOM.querySelectorAll', { nodeId: doc.result.root.nodeId, selector: 'input[type=file]' });
    const ids = q.result.nodeIds;
    let target = null;
    for (const nid of ids) {
      const a = await call('DOM.getAttributes', { nodeId: nid });
      const at = a.result.attributes;
      const acc = at.indexOf('accept') >= 0 ? at[at.indexOf('accept') + 1] : '';
      if (/image/.test(acc)) target = nid;
    }
    if (!target && ids.length) target = ids[ids.length - 1];
    if (target) {
      await call('DOM.setFileInputFiles', { files: refs, nodeId: target });
      for (let i = 0; i < 60; i++) {
        await sleep(1000);
        const n = await ev(`document.querySelectorAll('form img, [data-testid*=attachment] img, div[class*=attachment] img').length`);
        const busy = await ev(`!!document.querySelector('[role=progressbar], circle[stroke-dasharray]')`);
        if (n >= refs.length && !busy) break;
      }
      await sleep(1200);
    }
  }

  // 输入文字
  const p = await ev(`(() => { const e = ${FIND_INPUT}; if (!e) return null; e.focus(); const b = e.getBoundingClientRect(); return {x: b.x + 20, y: b.y + b.height / 2}; })()`);
  if (!p) throw new Error('找不到输入框（登录过期？）');
  await clickAt(p);
  await ev(`(() => { const e = ${FIND_INPUT}; e.focus(); })()`);
  await call('Input.insertText', { text: prompt });
  await sleep(900);
  const typedLen = await ev(`(() => { const e = ${FIND_INPUT}; return e ? (e.value !== undefined ? e.value.length : e.innerText.length) : -1; })()`);
  if (!typedLen || typedLen < 2) throw new Error('文字没进输入框');
  // React 受控组件：insertText 有时不触发 onChange，用原生 setter 兜一次，发送按钮才会亮
  await ev(`(() => {
    const e = ${FIND_INPUT}; if (!e || e.tagName !== 'TEXTAREA') return;
    if (!e.value) return;
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    const v = e.value; set.call(e, ''); set.call(e, v);
    e.dispatchEvent(new Event('input', {bubbles: true}));
  })()`);
  await sleep(600);

  // 发送
  let sent = false;
  for (let i = 0; i < 30 && !sent; i++) {
    sent = await ev(`(() => {
      const bs = [...document.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 0);
      const b = bs.find(x => (x.getAttribute('data-testid') || '').includes('send') && !x.disabled)
             || bs.find(x => /^(发送|Send)/.test(x.getAttribute('aria-label') || '') && !x.disabled);
      if (!b) return false; b.click(); return true;
    })()`);
    if (!sent) await sleep(800);
  }
  if (!sent) {
    await ev(`(() => { const e = ${FIND_INPUT}; e.focus(); })()`);
    for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await sleep(2500);
    sent = await ev(`document.querySelectorAll('[data-message-author-role=user]').length > 0`);
  }
  if (!sent) throw new Error('发送失败');
  console.error('已发送，等出图…');

  // 等图
  let src = null, stable = 0, last = null;
  for (let i = 0; i < 180; i++) {
    await sleep(3000);
    const s = await ev(`(() => {
      const imgs = [...document.querySelectorAll('img')].filter(im => {
        if (!(im.naturalWidth > 512)) return false;
        const alt = im.getAttribute('alt') || '';
        const src = im.currentSrc || im.src || '';
        return /已生成图像|Generated image|生成的图/.test(alt) || /oaiusercontent|estuary|blob:/.test(src);
      });
      const im = imgs.pop();
      return im ? (im.currentSrc || im.src) + '|' + im.naturalWidth + 'x' + im.naturalHeight : null;
    })()`);
    const stillGen = await ev(`/正在创建|正在生成|Creating image|Generating images?/.test(document.body.innerText)`);
    if (s && !stillGen) {
      if (s === last) stable++; else { stable = 0; last = s; }
      if (stable >= 2) { src = s.split('|')[0]; break; }
    }
    if (i > 15 && !s) {
      const refusal = await ev(`(() => { const r = [...document.querySelectorAll('[data-message-author-role=assistant]')].pop(); return r ? r.innerText.slice(0,300) : ''; })()`);
      if (/无法|不能|抱歉|违反|can't|unable|policy|限制|上限|limit/i.test(refusal || '')) throw new Error('被拒绝或受限：' + refusal.slice(0, 200));
    }
  }
  if (!src) throw new Error('等不到图（超时）');

  const b64 = await ev(`(async () => {
    const r = await fetch(${JSON.stringify(src)}, {credentials: 'include'});
    const b = new Uint8Array(await r.arrayBuffer());
    let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s);
  })()`);
  if (!b64) throw new Error('下载失败');
  const fs = await import('node:fs');
  const path = await import('node:path');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
  console.log(outPath);
}

for (let k = 1; k <= N; k++) {
  const o = N > 1 ? out.replace(/(\.\w+)$/, `-${k}$1`) : out;
  await one(o);
}
process.exit(0);
