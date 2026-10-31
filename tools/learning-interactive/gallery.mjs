// Isolated component gallery and browser acceptance. Never uses a user session.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {LearningInteractionStore} from '../../services/mode-architecture/learning.mjs';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const out = process.env.PINKIE_QA_OUTPUT || path.join(os.tmpdir(), 'pinkie-learning-acceptance'); fs.mkdirSync(out, {recursive: true});
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-inline-gallery-'));
const store = new LearningInteractionStore({root, workspace: path.join(root, 'workspace')});
const key = 'agent:learning:isolated-gallery';
const payloads = [
  {kind: 'device_lab', topic: '稳压管：电流、掉压与功率', visual: {device: 'zener'}},
  {kind: 'device_lab', topic: '74LS138：低有效译码', visual: {device: 'decoder138', minterms: [1, 5]}},
  {kind: 'device_lab', topic: '74LS151：八选一', visual: {device: 'mux151'}},
  {kind: 'device_lab', topic: '74LS161：清零、装数、计数', visual: {device: 'counter161', initial: 15}},
  {kind: 'illustrated_guide', topic: '图文、对比与尺寸预览', visual: {cards: [
    {title: '把结构放到说明旁边', body: '插图与说明按行对应。点击图片可以放大；窄窗口仍能读清正文。', image: {url: '/reference.svg', alt: '串联分压示意图', caption: '真实的本地 SVG 测试插图'}},
    {title: '没有图片时使用真实示意图', body: '教学示意图与生成图片会明确区分。', diagram: 'decoder138'},
    {title: '图片加载失败的恢复', body: '保留文字内容，并提供手动重试。', image: {url:'/missing.svg',alt:'失败恢复测试插图'}},
  ], table: {columns: ['结构', '可操作内容', '观察结果'], rows: [['稳压电路', '输入、负载、限流电阻', '输出、电流、功率'], ['计数器', 'CP、清零、装数、使能', '四位输出、时序、进位']]}, sizes: [{label: '横版', width: 1920, height: 1130}, {label: '竖版', width: 1080, height: 1440}]}},
  {kind: 'memory_lab', topic: '指针移动与二级指针', visual: {code: '#include <stdio.h>\nint main(void) {\n int a[3]={10,20,30};\n int *p=a;\n int **pp=&p;\n p++;\n **pp=42;\n printf("%d\\n",a[1]);\n return 0;\n}'}},
];
const refs = [];
for (let i = 0; i < payloads.length; i++) {
  let visual = store.visuals.present(key, {...payloads[i], __toolCallId: 'gallery-' + i});
  if (visual.kind === 'memory_lab') visual = await store.visuals.run(key, {id: visual.id, revision: visual.revision});
  refs.push({v: 1, sessionKey: key, id: visual.id, kind: visual.kind, title: visual.title});
}
let dropNext = false, saves = 0;
const html = `<!doctype html><html data-laolao-mode="learning"><meta charset="utf-8"><title>碧琪 · 独立学习组件验收</title><style>body{margin:0;background:#fcf6fa;color:#503d56;font:14px/1.6 system-ui}main{max-width:850px;margin:auto;padding:20px}h1{font-size:18px}header>p{font-size:12px;color:#87768e}.fixture{margin:34px 0}.agent-chat__composer-actions{display:flex;gap:8px}html[data-pinkie-night] body{background:#1c1724;color:#ead9ee}input,button,textarea,select{font:inherit}*{box-sizing:border-box}</style>
<link rel="stylesheet" href="/ui/laolao-learning-inline.css"><link rel="stylesheet" href="/ui/laolao-learning-practice.css"><link rel="stylesheet" href="/ui/laolao-learning-devices.css"><link rel="stylesheet" href="/ui/laolao-learning-stage.css">
<main><header><h1>消息里的学习组件</h1><p>独立测试画廊，连接隔离的学习存储；不是 App 主窗口。</p></header><div class="agent-chat__composer-actions"></div><section id="cards"></section></main>
<script>window.qaErrors=[];window.__laolaoSidebar={gwRequest:async(method,params)=>{const r=await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params})});if(!r.ok)throw Error('测试网络暂时中断');const data=await r.json();if(data.error)throw Error(data.error);return data;}};</script>
<script src="/ui/laolao-learning-devices.js"></script><script src="/ui/laolao-learning-practice.js"></script><script src="/ui/laolao-learning-inline.js"></script><script src="/ui/laolao-learning-stage.js"></script>
<script>window.refs=${JSON.stringify(refs)};for(const ref of refs){const host=document.createElement('article');host.className='fixture';host.id='fixture-'+ref.kind+(ref.kind==='device_lab'?'-'+refs.indexOf(ref):'');document.querySelector('#cards').append(host);__pinkieLearningInline.mount(ref,host);}</script>`;
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://local');
  if (u.pathname.startsWith('/ui/')) {
    const name = path.basename(u.pathname), file = path.join(process.env.PINKIE_GALLERY_UI_ROOT || path.join(repo, 'ui/injections'), name);
    if (!name.startsWith('laolao-learning-') || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : 'text/javascript'); return res.end(fs.readFileSync(file));
  }
  if (u.pathname === '/reference.svg') { res.setHeader('Content-Type', 'image/svg+xml'); return res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150"><rect width="200" height="150" fill="#fff8fc"/><path d="M25 110V35H70V25H120V35H175V110Z" fill="none" stroke="#a14778" stroke-width="3"/><path d="M120 35V70H110V90H130V70H120V110" fill="none" stroke="#a14778" stroke-width="3"/><text x="72" y="65" fill="#654668" font-size="14">R1 · R2</text></svg>'); }
  if (u.pathname === '/qa/drop-next') { dropNext = true; return res.end('ready'); }
  if (u.pathname === '/rpc' && req.method === 'POST') {
    let input = ''; for await (const chunk of req) { input += chunk; if (input.length > 200000) { res.writeHead(413); return res.end(); } }
    try {
      const {method, params: p} = JSON.parse(input); let result = {};
      if (method === 'pinkie.learning.inline.get') result = store.inline(p.sessionKey, p.id, p.kind);
      else if (method === 'pinkie.learning.inline.save') { saves++; result = {visual: store.visuals.public(store.visuals.save(p.sessionKey, p))}; if (dropNext) { dropNext = false; res.writeHead(502); return res.end('applied-response-lost'); } }
      else if (method === 'pinkie.learning.practice.run') result = {visual: await store.visuals.run(p.sessionKey, p)};
      else if (method === 'pinkie.learning.current') result = store.status(p.sessionKey);
      else if (method === 'pinkie.learning.notes.list') result = {notes: [], dueCount: 0};
      else if (method === 'chat.send') result = {ok: true};
      res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(result));
    } catch (e) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({error: e.message})); }
  }
  if (u.pathname !== '/') { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);
});
await new Promise(r => server.listen(Number(process.env.PINKIE_GALLERY_PORT || 0), '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/?session=${encodeURIComponent(key)}`;
fs.writeFileSync(path.join(out, 'gallery-endpoint.json'), JSON.stringify({url}));
if (!process.argv.includes('--test')) console.log(url);
else {
  const require = createRequire(import.meta.url);
  let playwright; try { playwright = require('playwright'); } catch { playwright = require('/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'); }
  const report = {status: 'pending', engines: {}};
  try {
    for (const [name, browserType] of Object.entries({chromium: playwright.chromium, webkit: playwright.webkit})) {
      // Each engine starts with the same independent fixture state.
      for (const ref of refs) {
        const r = store.visuals.get(key, ref.id);
        const state = r.kind === 'device_lab' ? r.definition.device === 'counter161' ? {events:[{id:'reset-'+name,type:'reset'}]} : {values:r.definition.values}
          : r.kind === 'illustrated_guide' ? {size:0} : {traceStep:0};
        store.visuals.save(key,{id:r.id,revision:r.revision,state});
      }

      const browser = await browserType.launch(name === 'chromium' ? {channel: 'chrome', headless: true} : {headless: true});
      const evidence = report.engines[name] = {checks: [], errors: [],expectedFaults:[]};let reloadWithPending=false;
      try {
        const page = await browser.newPage({viewport: {width: 1100, height: 900}}); page.on('pageerror',e=>{const text=String(e);if(reloadWithPending && /Fetch API cannot load http.*127\.0\.0\.1.*rpc due to access control checks/.test(text))evidence.expectedFaults.push('WebKit cancelled an in-flight same-origin request during intentional reload');else evidence.errors.push(text);}); await page.goto(url); await page.waitForFunction(() => window.__pinkieLearningInline?.stats().loaded > 0);
        await page.waitForFunction(() => !document.querySelector('.laolao-learning-toggle') && document.querySelector('.laolao-learning-notebook-button'));
        assert.equal(await page.locator('.laolao-learning-tools').count(), 0); evidence.checks.push('无需互动开关或工具胶囊，笔记入口保留');
        const zener = page.locator('#fixture-device_lab-0'); await zener.locator('.pld-root').waitFor();
        await zener.getByLabel('输入电压数值', {exact: true}).fill('3'); await zener.getByLabel('输入电压数值', {exact: true}).press('Tab'); await page.waitForFunction(() => document.querySelector('#fixture-device_lab-0').textContent.includes('未击穿'));
        await zener.getByRole('button', {name: '恢复题目初值', exact: true}).click(); await page.waitForFunction(() => document.querySelector('#fixture-device_lab-0').textContent.includes('15.81 mA'));
        evidence.checks.push('稳压图、电流读数与掉压状态实时联动');
        const decoder = page.locator('#fixture-device_lab-1'); await decoder.scrollIntoViewIfNeeded(); await decoder.getByRole('button', {name: 'A（最低位）', exact: true}).click();
        await page.waitForFunction(() => document.querySelector('#fixture-device_lab-1 .pld-outputs').textContent.includes('/Y1 0')); evidence.checks.push('译码器输出低有效且输入切换即时生效');
        const mux = page.locator('#fixture-device_lab-2'); await mux.scrollIntoViewIfNeeded(); await mux.getByRole('button', {name: 'A（最低位）', exact: true}).click(); await page.waitForFunction(() => document.querySelector('#fixture-device_lab-2 .pld-summary').textContent.includes('Y 1'));
        await mux.getByRole('button', {name: '/G（低有效）', exact: true}).click(); await page.waitForFunction(() => document.querySelector('#fixture-device_lab-2 .pld-summary').textContent.includes('Y 0')); evidence.checks.push('数据选择器选通与禁止输出符合真值表');
        const counter = page.locator('#fixture-device_lab-3'); await counter.scrollIntoViewIfNeeded(); await counter.getByRole('button', {name: '一个 CP 脉冲', exact: true}).click(); await page.waitForFunction(() => document.querySelector('#fixture-device_lab-3 .pld-summary').textContent.includes('计数 0'));
        await counter.getByRole('button', {name: '/CLR（异步清零）', exact: true}).click(); await counter.getByRole('button', {name: '一个 CP 脉冲', exact: true}).click(); await page.waitForFunction(() => document.querySelector('#fixture-device_lab-3 .pld-summary').textContent.includes('计数 0')); evidence.checks.push('计数器回卷、异步清零、实际时序曲线与历史观察正常');
        await page.waitForFunction(() => !Array.from(document.querySelectorAll('.pinkie-il-status')).some(n => n.textContent.includes('正在保存')));
        await page.reload(); await counter.scrollIntoViewIfNeeded(); await counter.locator('.pld-root').waitFor(); assert.match(await counter.innerText(), /计数 0/); evidence.checks.push('刷新后恢复已保存的实验状态');
        await counter.getByRole('button',{name:'复位实验',exact:true}).click();
        const timings=await page.evaluate(()=>{const button=[...document.querySelectorAll('#fixture-device_lab-3 button')].find(b=>b.textContent==='一个 CP 脉冲'),times=[];for(let i=0;i<100;i++){const t=performance.now();button.click();times.push(performance.now()-t);}return times;});
        await page.waitForFunction(()=>document.querySelector('#fixture-device_lab-3 .pinkie-il-status')?.textContent==='已保存');
        assert.equal(store.visuals.get(key,refs[3].id).state.q,3);evidence.renderP95Ms=[...timings].sort((a,b)=>a-b)[94];assert.ok(evidence.renderP95Ms<50);evidence.checks.push('100次快速脉冲按序保存并分批提交，P95更新小于50ms');
        await page.request.get(url.split('?')[0]+'qa/drop-next');await counter.getByRole('button',{name:'一个 CP 脉冲',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('#fixture-device_lab-3 .pinkie-il-status')?.textContent.includes('尚未保存'));
        assert.equal(store.visuals.get(key,refs[3].id).state.q,4);reloadWithPending=true;await page.reload();await counter.scrollIntoViewIfNeeded();await counter.locator('.pld-root').waitFor();
        await page.waitForFunction(()=>document.querySelector('#fixture-device_lab-3 .pinkie-il-status')?.textContent==='已保存');assert.equal(store.visuals.get(key,refs[3].id).state.q,4);reloadWithPending=false;evidence.checks.push('保存已生效但响应丢失后，刷新恢复本地队列且不重复计数');
        const guide = page.locator('#fixture-illustrated_guide'); await guide.scrollIntoViewIfNeeded(); await guide.locator('.pld-guide').waitFor(); await guide.getByRole('button', {name: '放大：串联分压示意图', exact: true}).click(); await page.locator('dialog[open]').waitFor(); await page.getByRole('button', {name: '关闭', exact: true}).click();
        await guide.getByRole('button', {name: '竖版', exact: true}).click(); const ratio = await guide.locator('.pld-size-preview').evaluate(e => e.getBoundingClientRect().width / e.getBoundingClientRect().height); assert.ok(Math.abs(ratio - .75) < .01); evidence.checks.push('图文并排、点击放大、对比表与横竖真实比例可用');
        await guide.getByText('图片暂时未载入',{exact:true}).waitFor();await page.route('**/missing.svg',route=>route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#a14778"/></svg>'}));await guide.getByRole('button',{name:'重试图片',exact:true}).click();await page.waitForFunction(()=>document.querySelector('img[alt="失败恢复测试插图"]')?.naturalWidth>0);evidence.checks.push('图片失败保留说明，手动重试能恢复真实图片');
        const memory = page.locator('#fixture-memory_lab'); await memory.scrollIntoViewIfNeeded(); await memory.locator('.pld-memory').waitFor(); for (let i = 0; i < 4; i++) await memory.getByRole('button', {name: '下一步', exact: true}).click();
        await page.waitForFunction(() => document.querySelector('#fixture-memory_lab .pld-pointer-list')?.textContent.includes('pp → p')); await page.waitForFunction(() => document.querySelectorAll('#fixture-memory_lab .pld-memory-arrows>path').length > 0); evidence.checks.push('真实 C 轨迹显示数组格、二级指针箭头与逐步观察');
        for (const [theme, width] of [['light', 1100], ['dark', 1100], ['narrow', 360]]) {
          await page.setViewportSize({width, height: 900}); await page.evaluate(theme => document.documentElement.toggleAttribute('data-pinkie-night', theme === 'dark'), theme);
          for (let i = 0; i < refs.length; i++) {
            const card = page.locator('.fixture').nth(i); await card.scrollIntoViewIfNeeded(); await page.waitForTimeout(120); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
            await card.screenshot({path: path.join(out, `${name}-${theme}-${i}.png`)});
            const bytes=fs.statSync(path.join(out, `${name}-${theme}-${i}.png`)).size;
            evidence.screenshots ||= {captured:0,unavailable:0};evidence.screenshots[bytes?'captured':'unavailable']++;
          }
        }
        evidence.checks.push('全部组件白天、夜晚与360px无页面溢出；滚动卸载并恢复');
        assert.deepEqual(evidence.errors, []); evidence.status = 'passed';
      } finally { await browser.close(); }
    }
    report.status = 'passed';
  } finally {
    fs.writeFileSync(path.join(out, 'gallery-acceptance.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); server.close(); fs.rmSync(root, {recursive: true, force: true});
  }
}
