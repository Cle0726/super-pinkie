// Isolated UI acceptance. Never connects to the running gateway or a user session.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
export function playwright() {
  try { return require('playwright'); }
  catch {}
  try { return require('playwright-core'); }
  catch { return require('/Applications/超級碧琪.app/Contents/Resources/SuperPinkie/runtime/openclaw/node_modules/playwright-core'); }
}
// 笔记本 v2 专用内存 mock。只在显式传给 harness.handler 时启用，不写学习数据。
export function createNotebookV2Mock() {
  const now = Date.now(), calls = [], backups = new Map();
  const exams = [
    {id: 'pretco-b', name: '英语 B 级', short: 'B级', english: true, approxSize: 2500},
    {id: 'zsb-en', name: '专升本英语', short: '专升本', english: true, approxSize: null},
    {id: 'cet4', name: '英语四级', short: '四级', english: true, approxSize: 4500},
    {id: 'cet6', name: '英语六级', short: '六级', english: true, approxSize: 6000},
  ];
  const samples = [
    ['规则', 'avoid / be worth 后接 -ing', 'avoid、be worth、enjoy、finish 后面必须接动名词。', 'This museum is well worth visiting.', '哪些常见动词后面接 -ing？', '非谓语动词'],
    ['易错', 'be used to doing 与 be used to do', 'be used to doing 是习惯于做某事，to 是介词；be used to do 是被用来做某事，to 是不定式。', 'Wood is used to make paper.', 'be used to doing 和 be used to do 有什么区别？', '非谓语动词'],
    ['句型', 'By the end of…', '接将来时间用将来完成时，接过去时间用过去完成时。', 'By the end of this month, we will have finished it.', 'By the end of 后面如何判断时态？', '时态'],
    ['方法', '名词后缀判断词性', '表示人的名词常有 -er / -or；-ment 通常表示事情或结果。', '', '怎样用后缀判断名词？', '词性'],
    ['规则', 'impact / influence / effect + on', '这三个词后面的介词固定用 on。', 'have an impact on', 'effect 后面搭配哪个介词？', '介词搭配'],
    ['概念', 'Once：一旦……就……', 'Once 引导条件状语从句，主句将来时，从句一般现在时。', 'Once you see it, you will understand.', 'Once 引导的从句用什么时态？', '从句'],
    ['摘录', '碧琪原话', '先看 to 后面是不是名词，再判断它是不是介词。', '', '', '学习方法'],
  ];
  let notes = samples.map(([noteType, title, content, example, cue, topic], i) => ({id: 'nv2-' + i, title, term: title, content, original: content, meaning: content, example, cue, topic, noteType, exam: 'pretco-b', subject: '语法', triagedAt: now - 86400000, status: 'active', tags: [], createdAt: now - i * 86400000, updatedAt: now - i * 86400000, sourceLabel: '碧琪回答', nextReviewAt: now - 1000, reviewCount: 0, lapses: i === 1 ? 2 : 0}));
  notes.push(...samples.slice(0, 3).map(([noteType, title, content, example, cue, topic], i) => ({id: 'inbox-' + i, title, content, original: content, status: 'active', triagedAt: 0, createdAt: now, sourceLabel: '聊天摘录', suggestion: {noteType, exam: 'pretco-b', subject: '语法', topic, title, cue, isVocab: false, words: [], at: now, model: 'harness'}})));
  notes.push({id: 'word-1', title: 'medical', content: 'medical / 医疗的、医学的（谐音：麦的扣）', original: 'medical / 医疗的、医学的（谐音：麦的扣）', status: 'active', triagedAt: 0, createdAt: now, sourceLabel: '碧琪', suggestion: {noteType: '', exam: '', subject: '', topic: '', title: '', isVocab: true, words: [{word: 'medical', hint: '医疗的、医学的', homophone: '麦的扣'}], at: now, model: 'harness'}});
  const copy = x => structuredClone(x), active = () => notes.filter(n => n.status === 'active');
  const filtered = p => notes.filter(n => (p.view === 'moved' ? n.status === 'moved' : p.includeMerged ? true : n.status === 'active') && (!p.inbox || !n.triagedAt) && (!p.exam || n.exam === p.exam) && (!p.subject || n.subject === p.subject) && (!p.topic || n.topic === p.topic) && (!p.noteType || n.noteType === p.noteType) && (p.view !== 'mistakes' || n.lapses > 0 || n.noteType === '易错') && (!p.query || JSON.stringify(n).toLowerCase().includes(p.query.toLowerCase())));
  function toc() {
    const grouped = exams.map(e => ({id: e.id, name: e.name, count: 0, subjects: []})); grouped.push({id: 'other', name: '其它', count: 0, subjects: []});
    for (const n of active().filter(n => n.triagedAt)) {
      const e = grouped.find(e => e.id === n.exam) || grouped.at(-1); e.count++;
      let s = e.subjects.find(s => s.name === n.subject); if (!s) e.subjects.push(s = {name: n.subject || '未分类', count: 0, topics: []}); s.count++;
      if (n.topic) { let t = s.topics.find(t => t.name === n.topic); if (!t) s.topics.push(t = {name: n.topic, count: 0}); t.count++; }
    }
    return {inbox: active().filter(n => !n.triagedAt).length, today: {count: Math.min(10, active().filter(n => n.nextReviewAt <= Date.now()).length), backlog: 0}, mistakes: active().filter(n => n.lapses > 0 || n.noteType === '易错').length, moved: notes.filter(n => n.status === 'moved').length, exams: grouped.filter(e => e.count || e.id === 'other')};
  }
  const handler = async (method, p = {}) => {
    calls.push({method, params: copy(p)}); const m = method.replace(/^pinkie\.learning\./, '');
    if (m === 'notes.toc') return copy(toc());
    if (m === 'notes.list') return copy({notes: filtered(p), total: filtered(p).length, section: null});
    if (m === 'notes.update') { const n = notes.find(n => n.id === p.id); if (!n) throw Error('笔记不存在'); Object.assign(n, p, {updatedAt: Date.now()}); return {note: copy(n)}; }
    if (m === 'notes.save') { const n = {id: 'new-' + now, content: p.content, original: p.content, title: p.title, status: 'active', triagedAt: 0, createdAt: Date.now()}; notes.push(n); return {note: copy(n), looksLikeVocab: false}; }
    if (m === 'notes.delete') { const n = notes.find(n => n.id === p.id); notes = notes.filter(n => n !== notes.find(n => n.id === p.id)); return {note: copy(n)}; }
    if (m === 'notes.restore') { notes.push(copy(p.note)); return {note: p.note}; }
    if (m === 'notes.organize.light') return {ok: true};
    if (m === 'notes.organizer.status') return {models: [{id: 'harness', name: '隔离模型'}], model: 'harness', available: true};
    if (m === 'notes.organizer.setModel') return {model: p.model};
    throw Error('unknown method: ' + method);
  };
  return {handler, calls, exams, backups, get notes() { return notes; }};
}
export async function isolatedService() {
  const {LearningInteractionStore, LearningNotesOrganizer, registerLearningGateway} = await import('../../services/mode-architecture/learning.mjs');
  const {LearningPact} = await import('../../services/mode-architecture/learning-pact.mjs');
  const root = fs.mkdtempSync(path.join(repo, 'tools/study-desk/isolated-'));
  const store = new LearningInteractionStore({root, workspace: path.join(root, 'workspace')}); store.pact = new LearningPact(store);
  const methods = new Map();
  const organizer = new LearningNotesOrganizer({}, store);
  organizer.status = () => ({available:true,model:'qa/recall',modelName:'隔离假模型',models:[]});
  organizer.requestModel = async (_model,rules,input,deep,options={}) => { if (!/笔记回忆卡/.test(rules)) throw Error('This isolated fixture only supplies recall questions'); const notes=options.userText?JSON.parse(options.userText).notes:input; return {notes:notes.map(note=>({id:note.id,cards:[{question:'请回忆这条笔记中最关键的规则。',answer:note.text,quote:note.text}]}))}; };
  // B 的讲义模块现在已注册。测试显式给空根目录和每例独立的 DB，既不发现真实磁盘，也不共享索引。
  const {LearningMaterials} = await import('../../services/mode-architecture/learning-materials.mjs');
  const materials = new LearningMaterials({root: path.join(root, 'materials'), roots: []});
  const routes = [];
  registerLearningGateway({registerGatewayMethod: (name, callback) => methods.set(name, callback), registerHttpRoute: route => routes.push(route)}, store, {organizer, materials});
  const handler = async (method, params) => {
    if (method === 'chat.send') return {runId: 'qa-chat', status: 'started'};
    if (method === 'chat.history') return {messages: []};
    if (!methods.has(method)) throw Error('unknown method: ' + method);
    return new Promise((resolve, reject) => methods.get(method)({params, respond: (ok, value, error) => ok ? resolve(value) : reject(Error(error?.message || 'RPC failed'))}));
  };
  return {handler, store, routes, close: async () => { await store.lessons?.saveChain; await store.recall?.running; await materials.close(); fs.rmSync(root, {recursive: true, force: true}); }};
}
export async function startHarness({vendor = true, handler = () => ({}), realUI = false, legacyUI = false, initialMessages = [], routes = [], port = 0} = {}) {
  const calls = [];
  const chatMessages = [...initialMessages], deskHistories = new Map();
  const injectionRoot = process.env.PINKIE_QA_INJECTION_ROOT || path.join(repo, 'ui/injections');
  const tags = fs.readFileSync(path.join(injectionRoot, 'laolao-head.fragment.html'), 'utf8').split('<!-- Study desk:')[1].split('-->')[1];
  const scripts = vendor ? tags : tags.replace(/<script[^>]+vendor\/[^>]+><\/script>/g, '');
  const installedControl = '/Applications/超級碧琪.app/Contents/Resources/SuperPinkie/runtime/openclaw/dist/control-ui';
  const controlRoot = process.env.PINKIE_CONTROL_UI_ROOT || (fs.existsSync(installedControl) ? installedControl : path.resolve(repo, '../sandbox/try/dist/control-ui'));
  const controlHTML = realUI ? fs.readFileSync(path.join(controlRoot, 'index.html'), 'utf8') : '';
  const entry = controlHTML.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/)?.[1];
  if (realUI && !entry) throw Error('没有找到真实 control-ui 入口；请设置 PINKIE_CONTROL_UI_ROOT');
  const coreCSS = [...new Set([...controlHTML.matchAll(/<link[^>]*href="([^"]*assets\/[^" ]+\.css)"/g)].map(m => m[1]))];
  const native = realUI ? '<openclaw-app></openclaw-app>' : '<div class="shell shell--chat"><h1>原生对话</h1><div class="chat-thread"></div><textarea aria-label="聊天输入"></textarea><div class="agent-chat__composer-actions"></div></div><div class="pk-wb">代码工具</div>';
  const legacy = realUI || legacyUI ? ['laolao-theme.css', 'laolao-classic-shell.css', 'laolao-learning-inline.css', 'laolao-learning-practice.css', 'laolao-learning-explore.css', 'laolao-learning-devices.css', 'laolao-learning-stage.css', 'laolao-learning-library.css'].map(name => `<link rel="stylesheet" href="/${name}">`).join('')
    + ['laolao-learning-devices.js', 'laolao-learning-explore.js', 'laolao-learning-practice.js', 'laolao-learning-inline.js', 'laolao-learning-stage.js', 'laolao-learning-library.js'].map(name => `<script defer src="/${name}"></script>`).join('') : '';
  const html = `<!doctype html><html data-laolao-mode="learning" data-theme-mode="light"><meta charset="utf-8"><title>学习台隔离验收</title>
    <style>body{margin:0;font:15px system-ui}.shell{padding:25px}.pk-wb{position:fixed;inset:0;background:red;pointer-events:none}button{font:inherit}</style>
    ${coreCSS.map(file => `<link rel="stylesheet" href="${file}">`).join('')}${native}
    <script>localStorage.setItem('openclaw.i18n.locale','zh-CN');window.qaCalls=[];const settings={gatewayUrl:location.origin.replace('http','ws'),sessionKey:'agent:learning:study-desk-qa',lastActiveSessionKey:'agent:learning:study-desk-qa',themeMode:'light',token:'qa'};const OriginalWebSocket=window.WebSocket;window.WebSocket=class extends OriginalWebSocket{constructor(url,protocols){super(settings.gatewayUrl+new URL(url,location.href).pathname,protocols);this.addEventListener('message',e=>{try{const m=JSON.parse(e.data);if(m.type==='event')dispatchEvent(new CustomEvent('pinkie:gateway-event',{detail:{event:m.event,payload:m.payload}}));}catch{}});}};for(const suffix of ['',':default',':'+settings.gatewayUrl])localStorage.setItem('openclaw.control.settings.v1'+suffix,JSON.stringify(settings));window.__laolaoSidebar={gwRequest:async(method,params)=>{qaCalls.push({method,params});const r=await fetch('/rpc',{method:'POST',body:JSON.stringify({method,params})});const data=await r.json();if(data?.error)throw Error(data.error);if(!${realUI}&&method==='chat.send'&&params.sessionKey.startsWith('agent:learning:desk-chat:'))setTimeout(()=>dispatchEvent(new CustomEvent('pinkie:gateway-event',{detail:{event:'chat',payload:{sessionKey:params.sessionKey,runId:data.runId,state:'final'}}})),0);return data;}};</script>${entry ? `<script type="module" src="${entry}"></script>` : ''}${legacy}${scripts}`;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    // 后端注册的 HTTP 路由（如真题原录音 /pinkie-exam-audio/）照网关的前缀匹配转过去
    for (const route of routes) if (url.pathname.startsWith(route.path) && route.handler(req, res)) return;
    if (url.pathname === '/rpc') {
      try {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const call = JSON.parse(raw); calls.push(call); res.setHeader('Content-Type', 'application/json'); let result=await handler(call.method,call.params);if(call.method==='chat.history'&&call.params.sessionKey.startsWith('agent:learning:desk-chat:')&&!result.messages?.length&&deskHistories.has(call.params.sessionKey))result={messages:deskHistories.get(call.params.sessionKey)};res.end(JSON.stringify(result));
        if (call.method === 'chat.send') {
          const message = {role: 'assistant', content: [{type: 'text', text: '隔离验收回复：已收到这道题的追问，点左侧舞台可回原题。'}], timestamp: Date.now()};
          if(call.params.sessionKey.startsWith('agent:learning:desk-chat:')){const own=deskHistories.get(call.params.sessionKey)||[];own.push({role:'user',content:call.params.message,timestamp:Date.now()},message);deskHistories.set(call.params.sessionKey,own);}else chatMessages.push({role: 'user', content: [{type: 'text', text: call.params.message}], timestamp: Date.now()}, message);
          setTimeout(() => { for (const socket of wss?.clients || []) if (socket.readyState === 1) socket.send(JSON.stringify({type: 'event', event: 'chat', payload: {runId: 'qa-chat', sessionKey: call.params.sessionKey, seq: 1, state: 'final', message}})); }, 30);
        }
      }
      catch (error) { if (!res.destroyed && !res.writableEnded) res.end(JSON.stringify({error: error.message})); } return;
    }
    if (url.pathname === '/' || url.pathname === '/chat') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
    const name = decodeURIComponent(url.pathname).replace(/^\//, '');
    if (name.includes('..')) { res.writeHead(404); res.end(); return; }
    if (url.pathname === '/__openclaw/control-ui-config.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({basePath: '', assistantName: '碧琪', assistantAvatar: '/laolao-mode-learning-hd.png', assistantAgentId: 'learning'})); return; }
    const files = [path.join(injectionRoot, name), path.join(repo, 'ui/injections', name), path.join(repo, 'ui/assets', name), ...(realUI ? [path.join(controlRoot, name)] : [])];
    const file = files.find(f => fs.existsSync(f) && fs.statSync(f).isFile());
    if (!file) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', ({'.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp'})[path.extname(file)] || 'application/octet-stream'); res.end(fs.readFileSync(file));
  });
  let wss;
  if (realUI) {
    let WS; try { WS = require('ws'); } catch { const bundle = require('/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/lib/utilsBundle.js'); WS = {WebSocketServer: bundle.wsServer}; }
    wss = new WS.WebSocketServer({server});
    wss.on('connection', socket => {
      socket.send(JSON.stringify({type: 'event', event: 'connect.challenge', payload: {nonce: 'isolated-qa', ts: Date.now()}}));
      socket.on('message', async raw => {
        let req; try { req = JSON.parse(String(raw)); } catch { return; }
        if (req.type !== 'req') return;
        const key = 'agent:learning:study-desk-qa';
        const session = {key, sessionId: 'study-desk-qa', kind: 'direct', label: '学习台验收', displayName: '学习台验收', updatedAt: Date.now()};
        try {
          const payload = req.method === 'connect' ? {type: 'hello-ok', protocol: 3, server: {version: 'isolated-qa', connId: 'qa'}, features: {methods: [], events: ['chat']}, snapshot: {presence: [], health: {}, sessionDefaults: {defaultAgentId: 'learning', mainSessionKey: key}}, auth: {role: 'operator', scopes: ['operator.admin', 'operator.read'], deviceToken: 'qa'}, policy: {tickIntervalMs: 30000}}
            : req.method === 'agents.list' ? {defaultId: 'learning', mainKey: key, agents: [{id: 'learning', name: '碧琪'}]}
            : req.method === 'sessions.list' ? {sessions: [session], defaults: {model: 'isolated-qa', contextTokens: 128000}}
            : req.method === 'sessions.resolve' ? {ok: true, ...session, agentId: 'learning'}
            : req.method === 'chat.history' ? {sessionKey: key, sessionId: 'study-desk-qa', messages: chatMessages, thinkingLevel: 'off'}
            : req.method.startsWith('pinkie.learning.') || req.method === 'chat.send' ? await handler(req.method, req.params || {}) : {};
          socket.send(JSON.stringify({type: 'res', id: req.id, ok: true, payload}));
        } catch (error) { socket.send(JSON.stringify({type: 'res', id: req.id, ok: false, error: {code: 'INVALID_REQUEST', message: error.message}})); }
      });
    });
  }
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return {url: `http://127.0.0.1:${server.address().port}/chat?session=agent:learning:study-desk-qa`, calls, realUI, close: () => { for (const client of wss?.clients || []) client.terminate(); wss?.close(); return new Promise(resolve => server.close(resolve)); }};
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--capture')) { await (await import('./capture.mjs')).capture({startHarness, isolatedService, playwright}); }
  else {
  const harness = await startHarness();
  const browser = await playwright().webkit.launch({headless: true});
  try {
    const output = process.env.PINKIE_QA_OUTPUT || path.join(repo, 'tools/study-desk/shots'); fs.mkdirSync(output, {recursive: true});
    const page = await browser.newPage({viewport: {width: 1440, height: 900}, deviceScaleFactor: 2});
    await page.goto(harness.url); await page.locator('#pinkie-study-desk').waitFor();
    await page.waitForTimeout(1800);
    const screenshot = await page.screenshot({path: path.join(output, 'webkit-a1-shell.png')});
    console.log(JSON.stringify({status: screenshot.length ? 'captured' : 'screenshot-unavailable', bytes: screenshot.length, output}));
  } finally { await browser.close(); await harness.close(); }
  }
}
