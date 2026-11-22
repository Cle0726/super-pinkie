import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {ToolTraceStore, serveToolImage} from '../services/mode-architecture/tool-trace.mjs';
import {pinkieSplitTimelineMessage} from '../patch/apply-chat-timeline.mjs';
import {playwright} from '../tools/study-desk/harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';

test(`read-image trace displays the correct image, survives restart, and stays session-scoped (${engine})`, {timeout: 30000}, async () => {
  const parent = fs.realpathSync(os.tmpdir());
  const root = fs.realpathSync(fs.mkdtempSync(path.join(parent, 'pinkie-image-e2e-')));
  assert.equal(path.dirname(root), parent);
  const imageA = path.join(root, '第一张.png'), imageB = path.join(root, '第二张.png');
  const assetA = path.join(repo, 'ui/assets/favicon-32.png'), assetB = path.join(repo, 'ui/assets/laolao-mode-thinking-sm.png');
  fs.copyFileSync(assetA, imageA); fs.copyFileSync(assetB, imageB);
  const stateRoot = path.join(root, 'state'), sessionKey = 'agent:metre:image-test';
  let store = new ToolTraceStore({root: stateRoot});
  for (const [callId, image] of [['read-a', imageA], ['read-b', imageB]]) {
    store.afterTool({toolName: 'read', toolCallId: callId, params: {path: image}, result: {content: [{type: 'image'}]}}, {sessionKey});
  }
  const timestamp = 1794647759985;
  const message = {role: 'assistant', timestamp, content: [
    {type: 'text', text: '先看第一张'},
    {type: 'toolCall', id: 'read-a', name: 'read', arguments: {path: imageA}},
    {type: 'text', text: '再看第二张'},
    {type: 'toolCall', id: 'read-b', name: 'read', arguments: {path: imageB}},
  ]};
  const key = `msg:assistant:${timestamp}:1`;
  const rows = pinkieSplitTimelineMessage({key, message}, () => [
    {callId: 'read-a', name: 'read', args: {path: imageA}},
    {callId: 'read-b', name: 'read', args: {path: imageB}},
  ]).filter(row => row.role === 'tool');
  const fixture = {message, sessionKey, rows: rows.map(row => row.key)};
  const html = `<!doctype html><meta charset="utf-8">
    <link rel="stylesheet" href="/laolao-theme.css"><link rel="stylesheet" href="/laolao-tool-rows.css"><link rel="stylesheet" href="/laolao-tool-images.css">
    <style>body{margin:32px;max-width:800px;font-family:sans-serif;background:#faf8fa}.pinkie-process{padding:16px;border:1px solid #ddd;border-radius:12px}.chat-tool-msg-summary{display:flex;align-items:center;min-height:50px}.cle-run{display:flex;align-items:center;min-height:50px}</style>
    <openclaw-chat-pane id="primary"><div class="pinkie-process"><div><button class="cle-run"><i></i><b>运行了 1 个命令，看了 ${'请详细描述这张图片里的内容。'.repeat(8)}</b><span></span></button></div><div id="rows" data-cle-member></div></div></openclaw-chat-pane>
    <openclaw-chat-pane id="other"><div id="foreign-row"><button class="chat-tool-msg-summary">另一个会话的图片</button></div></openclaw-chat-pane>
    <script>const fixture=${JSON.stringify(fixture).replace(/</g, '\\u003c')};
      document.querySelector('#primary').state={sessionKey:fixture.sessionKey,chatMessages:[{role:'user'},fixture.message]};
      document.querySelector('#other').state={sessionKey:'agent:metre:other',chatMessages:[{role:'user'},fixture.message]};
      document.querySelector('#foreign-row').dataset.messageId=fixture.rows[0];
      fixture.rows.forEach((id,i)=>{const el=document.createElement('div');el.dataset.messageId=id;el.id='row'+i;
        el.innerHTML='<button class="chat-tool-msg-summary">读取图片</button>';document.querySelector('#rows').append(el)});
      window.__laolaoSidebar={gwRequest:async (_method,params)=>fetch('/trace?session='+encodeURIComponent(params.sessionKey)).then(r=>r.json())};
    </script><script src="/laolao-image-viewer.js"></script><script src="/laolao-tool-kind.js"></script><script src="/laolao-tool-images.js"></script>`;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/pinkie-tool-image/')) return serveToolImage(store, req, res);
    if (url.pathname === '/trace') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(store.list(url.searchParams.get('session'))));return;}
    if (url.pathname === '/') {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
    if (/^\/laolao-(?:image-viewer|tool-kind|tool-images)\.js$/.test(url.pathname) || /^\/laolao-(?:theme|tool-rows|tool-images)\.css$/.test(url.pathname)) {
      res.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(repo,'ui/injections',url.pathname.slice(1))));return;
    }
    res.statusCode=404;res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await playwright()[engine].launch(engine === 'chromium' ? {headless:true,channel:'chrome'} : {headless:true});
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/?session=${encodeURIComponent(sessionKey)}`);
    await page.evaluate(() => window.__pinkieToolImages.refresh());
    await page.locator('#row0 .pinkie-tool-thumb img').waitFor();
    assert.equal(await page.locator('#row0 .pinkie-tool-thumb img').getAttribute('alt'), '第一张.png');
    assert.equal(await page.locator('#row1 .pinkie-tool-thumb img').getAttribute('alt'), '第二张.png');
    assert.equal(await page.locator('#foreign-row .pinkie-tool-thumb').count(), 0, 'another split session must not borrow this session’s image, even for the same call id');
    for (const [selector, expectedFile] of [['#row0 .pinkie-tool-thumb img', imageA], ['#row1 .pinkie-tool-thumb img', imageB]]) {
      const src = await page.locator(selector).getAttribute('src');
      const response = await page.request.get(new URL(src, page.url()).href);
      assert.equal(response.status(), 200);
      assert.deepEqual(await response.body(), fs.readFileSync(expectedFile), 'thumbnail URL serves this call’s actual image bytes');
    }
    assert.equal(await page.locator('.cle-run .pinkie-tool-thumb').count(), 2);
    const foldedRow = await page.locator('.cle-run').boundingBox();
    const foldedImage = await page.locator('.cle-run .pinkie-tool-thumb').last().boundingBox();
    assert.ok(foldedRow && foldedImage && foldedImage.x + foldedImage.width <= foldedRow.x + foldedRow.width,
      'a long tool label must leave room for the thumbnail inside the folded row');
    await page.waitForFunction(() => [...document.querySelectorAll('#row0 .pinkie-tool-thumb img,#row1 .pinkie-tool-thumb img')].every(img => img.complete && img.naturalWidth > 0));
    const box = await page.locator('#row0 .pinkie-tool-thumb').boundingBox();
    assert.ok(box && box.width === 40 && box.height === 40, 'the actual thumbnail CSS remains visible at 40×40');
    if (process.env.PINKIE_IMAGE_UI_SHOT) await page.screenshot({path: process.env.PINKIE_IMAGE_UI_SHOT});
    await page.locator('#row0 .pinkie-tool-thumb').click();
    assert.equal(await page.locator('#laolao-image-viewer img').getAttribute('alt'), '第一张.png');
    await page.locator('#laolao-image-viewer button').click();
    store = new ToolTraceStore({root: stateRoot});
    await page.reload(); await page.evaluate(() => window.__pinkieToolImages.refresh());
    assert.equal(await page.locator('#row1 .pinkie-tool-thumb img').getAttribute('alt'), '第二张.png');
    fs.unlinkSync(imageB);
    await page.evaluate(() => window.__pinkieToolImages.refresh());
    assert.equal(await page.locator('#row1 .pinkie-tool-thumb.is-gone').count(), 1);
    await page.evaluate(() => {history.pushState({}, '', '/?session=agent%3Ametre%3Aother');window.dispatchEvent(new CustomEvent('pinkie:session-selected'));});
    await page.evaluate(() => window.__pinkieToolImages.refresh());
    assert.equal(await page.locator('.pinkie-tool-thumb').count(), 0);
  } finally {
    try { await browser?.close(); }
    finally {
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
      const target = fs.realpathSync(root);
      if (target !== root || path.dirname(target) !== parent) throw new Error('Refusing to remove a changed test directory');
      fs.rmSync(target, {recursive:true,force:true});
    }
  }
});
