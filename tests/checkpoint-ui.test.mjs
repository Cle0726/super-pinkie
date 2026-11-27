// M6「回到这一轮之前」界面（设计-M6 第一节、第六节第 2 条）：静态页 + 假网关，真浏览器跑。
// PINKIE_IMAGE_UI_ENGINE=webkit 时走 WebKit（按键用 Alt+Tab），默认 Chromium。
import {after, test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const inj = (name) => fs.readFileSync(path.join(root, 'ui', 'injections', name), 'utf8');
const JS = inj('laolao-checkpoint.js');
const CSS = inj('laolao-checkpoint.css');
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
const TAB = engine === 'webkit' ? 'Alt+Tab' : 'Tab';
const SHIFT_TAB = engine === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab';

let browserPromise = null;
const browser = () => (browserPromise ??= playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})}));
after(async () => { const b = await browserPromise?.catch(() => null); if (b) await b.close(); });

const KEY = 'agent:main:main';
const HISTORY = [
  {id: 'u1', role: 'user', content: '第一句', __openclaw: {id: 'E-u1'}},
  {id: 'a1', role: 'assistant', content: '答一', __openclaw: {id: 'E-a1'}},
  {id: 'u2', role: 'user', content: '第二句', __openclaw: {id: 'E-u2'}},
  {id: 'a2a', role: 'assistant', content: '答二上', __openclaw: {id: 'E-a2a'}},
  {id: 'a2b', role: 'assistant', content: '答二下', __openclaw: {id: 'E-a2b'}},
  {id: 'u3', role: 'user', content: '第三句', __openclaw: {id: 'E-u3'}},
  {id: 'a3', role: 'assistant', content: '答三', __openclaw: {id: 'E-a3'}},
];
const LIST = {ok: true, running: false, turns: [
  {turn: 1, userEntryId: 'E-u1', assistantEntryIds: ['E-a1'], auditIncomplete: false},
  {turn: 2, userEntryId: 'E-u2', assistantEntryIds: ['E-a2a', 'E-a2b'], auditIncomplete: true},
]};
const PREVIEW = {ok: true, turn: 2, running: false, text: '第二句',
  restore: [{path: 'notes/a.txt', action: 'modify'}, {path: 'new.txt', action: 'delete'}],
  conflicts: [{path: 'shared/b.txt', action: 'modify'}],
  unrecoverable: [{path: 'big.bin', reason: 'too-large'}],
  auditIncomplete: [2]};
const RESTORE = {ok: true, turn: 2, restored: 2, skipped: [], unrecoverable: [{path: 'big.bin', reason: 'too-large'}]};

const group = (role, id, text) => `<div class="chat-group ${role}"><div class="chat-group-messages">`
  + `<div class="chat-bubble" style="position:relative;padding:8px 12px;min-height:40px" data-message-id="msg:${id}"><div class="chat-text">${text}</div></div></div>`
  + '<div class="chat-group-footer"><div class="chat-group-footer-actions"></div></div></div>';
const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body style="font:14px sans-serif;margin:16px">
<button id="before" type="button">前</button>
<openclaw-chat-pane style="display:block;width:720px">${HISTORY.map(m => group(m.role, m.id, m.content)).join('')}
<div class="agent-chat__composer-combobox"><textarea></textarea></div></openclaw-chat-pane></body></html>`;

async function open({key = KEY, list = LIST, preview = PREVIEW, restore = RESTORE, state = {}, css = ''} = {}) {
  const context = await (await browser()).newContext({viewport: {width: 1000, height: 800}});
  const page = await context.newPage();
  await page.setContent(PAGE);
  if (css) await page.addStyleTag({content: css});
  await page.addStyleTag({content: CSS});
  await page.evaluate(({HISTORY, list, preview, restore, state}) => {
    window.__calls = [];
    window.__resp = {'pinkie.checkpoint.list': list, 'pinkie.checkpoint.preview': preview, 'pinkie.checkpoint.restore': restore,
      'chat.history': {messages: HISTORY.slice(0, 2)}};
    window.__laolaoSidebar = {gwRequest: async (method, params) => { window.__calls.push({method, params}); return structuredClone(window.__resp[method]); }};
    const pane = document.querySelector('openclaw-chat-pane');
    const textarea = pane.querySelector('textarea');
    pane.state = {chatMessages: structuredClone(HISTORY), chatMessage: '', ...state,
      handleChatDraftChange(text) { this.chatMessage = text; textarea.value = text; }};
    pane.requestUpdate = () => {};
  }, {HISTORY, list, preview, restore, state});
  await page.addScriptTag({content: JS});
  await turns(page, key);
  return {page, close: () => context.close()};
}
const turns = async (page, key = KEY) => {
  await page.evaluate(key => document.querySelector('openclaw-chat-pane').dispatchEvent(new CustomEvent('pk-chat-turns', {bubbles: true, detail: {key}})), key);
  await page.waitForFunction(() => window.__calls.some(c => c.method === 'pinkie.checkpoint.list'));
  await page.waitForTimeout(50);
};
const keys = page => page.$$eval('.pinkie-ckpt', nodes => nodes.map(n => ({
  bubble: n.dataset.messageId, footer: Boolean(n.closest('.chat-group-footer-actions')), entryId: n.dataset.entryId, turn: n.dataset.turn,
  label: n.querySelector('.pinkie-ckpt__btn').textContent, disabled: n.querySelector('.pinkie-ckpt__btn').getAttribute('aria-disabled'),
  tabIndex: n.querySelector('.pinkie-ckpt__btn').tabIndex, hint: getComputedStyle(n.querySelector('.pinkie-ckpt__hint')).display !== 'none'})));
const calls = (page, method) => page.evaluate(m => window.__calls.filter(c => c.method === m).map(c => c.params), method);
async function clickKey(page, bubble = 'msg:a2b') {
  const sel = `[data-message-id="${bubble}"]`;
  await page.hover(sel);
  await page.click(`.pinkie-ckpt${sel} > .pinkie-ckpt__btn`);
  await page.waitForSelector('.pinkie-ckpt-modal');
}

test('跑完且 list 里有的轮才有键；每轮只在最后一条回答上；键可用、能 Tab 到', async () => {
  const {page, close} = await open();
  try {
    assert.deepEqual(await keys(page), [
      {bubble: 'msg:a1', footer: true, entryId: 'E-a1', turn: '1', label: '回到这一轮之前', disabled: null, tabIndex: 0, hint: false},
      {bubble: 'msg:a2b', footer: true, entryId: 'E-a2b', turn: '2', label: '回到这一轮之前', disabled: null, tabIndex: 0, hint: false},
    ]);
    assert.deepEqual(await calls(page, 'pinkie.checkpoint.list'), [{sessionKey: KEY}]);
    await page.focus('#before');
    await page.keyboard.press(TAB);
    assert.equal(await page.evaluate(() => document.activeElement.closest('.pinkie-ckpt')?.dataset.messageId), 'msg:a1');
    assert.equal(await page.$eval('.pinkie-ckpt[data-message-id="msg:a1"]', n => getComputedStyle(n).opacity), '1', 'focus-within 时键要显出来');
  } finally { await close(); }
});

test('在跑时键是灰的、不进 Tab 序列、旁边写「先停下再回退」，点了不调 preview', async () => {
  for (const variant of [{state: {chatRunId: 'run-1'}}, {list: {...LIST, running: true}}]) {
    const {page, close} = await open(variant);
    try {
      await page.waitForFunction(() => document.querySelectorAll('.pinkie-ckpt[data-busy]').length === 2);
      for (const k of await keys(page)) { assert.equal(k.disabled, 'true'); assert.equal(k.tabIndex, -1); assert.equal(k.hint, true); }
      assert.equal(await page.$eval('.pinkie-ckpt__hint', n => n.textContent), '先停下再回退');
      await page.focus('#before');
      await page.keyboard.press(TAB);
      assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('.pinkie-ckpt'))), false);
      await page.hover('[data-message-id="msg:a2b"]');
      await page.click('[data-message-id="msg:a2b"] .pinkie-ckpt__btn', {force: true});
      await page.waitForTimeout(100);
      assert.deepEqual(await calls(page, 'pinkie.checkpoint.preview'), []);
      assert.equal(await page.$('.pinkie-ckpt-modal'), null);
    } finally { await close(); }
  }
});

test('子会话和只读角色会话不画键', async () => {
  for (const key of ['agent:main:subagent:abc', 'agent:main:persona:tutor', 'agent:main:persona-tutor']) {
    const {page, close} = await open({key});
    try { assert.deepEqual(await keys(page), [], key); } finally { await close(); }
  }
});

test('确认框：三组分开列、冲突默认不勾、提示命令改动可能不全、焦点在「算了」；「算了」与 Esc 都不调 restore', async () => {
  const {page, close} = await open();
  try {
    await clickKey(page);
    assert.deepEqual(await calls(page, 'pinkie.checkpoint.preview'), [{sessionKey: KEY, assistantEntryId: 'E-a2b'}]);
    const modal = await page.$eval('.pinkie-ckpt-modal', box => ({
      role: box.getAttribute('role'), label: document.getElementById(box.getAttribute('aria-labelledby'))?.textContent,
      body: box.querySelector('.laolao-modal__body').textContent,
      groups: [...box.querySelectorAll('.pinkie-ckpt-group')].map(g => [g.querySelector('h4').textContent,
        ...[...g.querySelectorAll('.pinkie-ckpt-file')].map(li => `${li.querySelector('code').textContent}|${li.querySelector('.pinkie-ckpt-file__note').textContent}`)]),
      checked: [...box.querySelectorAll('input[type=checkbox]')].map(i => i.checked),
      note: box.querySelector('.pinkie-ckpt-note')?.textContent,
      buttons: [...box.querySelectorAll('.laolao-modal__buttons button')].map(b => b.textContent),
      focus: document.activeElement.textContent}));
    assert.deepEqual(modal, {role: 'alertdialog', label: '回到第 2 轮之前',
      body: '第 2 轮和之后的对话会撤掉；这几轮里改过的文件会还原。',
      groups: [['会还原', 'notes/a.txt|改回原样', 'new.txt|删掉（这几轮新建的）'],
        ['之后被别处改过（勾上才覆盖）', 'shared/b.txt|改回原样'], ['还原不了', 'big.bin|太大没存']],
      checked: [false], note: '第 2 轮用命令改过的文件可能没有全列出来', buttons: ['算了', '回到这一轮之前'], focus: '算了'});
    await page.keyboard.press('Escape');
    assert.equal(await page.$('.pinkie-ckpt-modal'), null);
    await clickKey(page);
    await page.click('.pinkie-ckpt-modal .laolao-modal__btn:not(.laolao-modal__btn--danger)');
    assert.equal(await page.$('.pinkie-ckpt-modal'), null);
    await page.waitForTimeout(100);
    assert.deepEqual(await calls(page, 'pinkie.checkpoint.restore'), []);
    assert.equal(await page.$eval('textarea', t => t.value), '');
  } finally { await close(); }
});

test('确认框键盘：Tab / Shift+Tab 在勾选框和两个键之间循环，不出框', async () => {
  const {page, close} = await open();
  try {
    await clickKey(page);
    const at = () => page.evaluate(() => document.activeElement.type === 'checkbox' ? 'pick' : document.activeElement.textContent);
    const seen = [await at()];
    for (let i = 0; i < 3; i++) { await page.keyboard.press(TAB); seen.push(await at()); }
    assert.deepEqual(seen, ['算了', '回到这一轮之前', 'pick', '算了']);
    await page.keyboard.press(SHIFT_TAB);
    assert.equal(await at(), 'pick');
  } finally { await close(); }
});

test('确认后才调 restore：带 __openclaw.id 和勾上的冲突文件；成功后重拉记录、回填那句话、提示还原了几个文件', async () => {
  const {page, close} = await open();
  try {
    await clickKey(page);
    await page.check('.pinkie-ckpt-modal input[type=checkbox]');
    await page.click('.pinkie-ckpt-modal .laolao-modal__btn--danger');
    await page.waitForSelector('.pinkie-ckpt-modal', {state: 'detached'});
    assert.deepEqual(await calls(page, 'pinkie.checkpoint.restore'), [{sessionKey: KEY, assistantEntryId: 'E-a2b', overwrite: ['shared/b.txt']}]);
    assert.deepEqual(await calls(page, 'chat.history'), [{sessionKey: KEY, limit: 200}]);
    await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA');
    assert.deepEqual(await page.evaluate(() => {
      const pane = document.querySelector('openclaw-chat-pane');
      return {draft: pane.state.chatMessage, value: pane.querySelector('textarea').value, count: pane.state.chatMessages.length};
    }), {draft: '第二句', value: '第二句', count: 2});
    assert.equal(await page.$eval('.pinkie-ckpt-toast', n => n.textContent), '已回到第 2 轮之前，还原了 2 个文件');
  } finally { await close(); }
});

test('失败时框里写原因、对话不变，可以再点；Esc 关掉后不再调 restore', async () => {
  const {page, close} = await open({restore: {ok: false, error: '会话正在被写入，请稍后再试'}});
  try {
    await clickKey(page);
    await page.click('.pinkie-ckpt-modal .laolao-modal__btn--danger');
    await page.waitForFunction(() => !document.querySelector('.pinkie-ckpt-modal .laolao-modal__error').hidden);
    assert.equal(await page.$eval('.pinkie-ckpt-modal .laolao-modal__error', n => n.textContent), '会话正在被写入，请稍后再试');
    assert.equal(await page.$eval('.pinkie-ckpt-modal .laolao-modal__btn--danger', b => b.disabled), false);
    assert.deepEqual(await calls(page, 'chat.history'), []);
    assert.equal(await page.evaluate(() => document.querySelector('openclaw-chat-pane').state.chatMessages.length), HISTORY.length);
    assert.equal(await page.$eval('textarea', t => t.value), '');
    await page.evaluate(() => { window.__resp['pinkie.checkpoint.restore'] = {ok: false}; });
    await page.click('.pinkie-ckpt-modal .laolao-modal__btn--danger');
    await page.waitForFunction(() => document.querySelector('.pinkie-ckpt-modal .laolao-modal__error').textContent === '没回退成功，请稍后再试');
    await page.keyboard.press('Escape');
    assert.equal(await page.$('.pinkie-ckpt-modal'), null);
    assert.equal((await calls(page, 'pinkie.checkpoint.restore')).length, 2);
  } finally { await close(); }
});

test('preview 失败或已在跑：只提示原因，不弹框', async () => {
  for (const [preview, text] of [[{ok: false, error: '这一轮的检查点已经不在了'}, '这一轮的检查点已经不在了'], [{...PREVIEW, running: true}, '先停下再回退']]) {
    const {page, close} = await open({preview});
    try {
      await page.hover('[data-message-id="msg:a1"]');
      await page.click('[data-message-id="msg:a1"] .pinkie-ckpt__btn');
      await page.waitForSelector('.pinkie-ckpt-toast[data-show]');
      assert.equal(await page.$eval('.pinkie-ckpt-toast', n => n.textContent), text);
      assert.equal(await page.$('.pinkie-ckpt-modal'), null);
      assert.deepEqual(await calls(page, 'pinkie.checkpoint.restore'), []);
    } finally { await close(); }
  }
});

test('键在回答下方操作栏，不压任何正文', async () => {
  const {page, close} = await open();
  try {
    await page.hover('[data-message-id="msg:a2b"]');
    const hits = await page.evaluate(() => {
      const k = document.querySelector('.pinkie-ckpt[data-message-id="msg:a2b"]').getBoundingClientRect();
      return [...document.querySelectorAll('.chat-text')].filter(t => {
        const r = t.getBoundingClientRect();
        return Math.min(k.bottom, r.bottom) > Math.max(k.top, r.top) && Math.min(k.right, r.right) > Math.max(k.left, r.left);
      }).map(t => t.textContent);
    });
    assert.deepEqual(hits, []);
  } finally { await close(); }
});

test('确认框：路径不吃全局 code 黄底，备注用实色、不靠 opacity', async () => {
  const {page, close} = await open({css: 'code { background: #fff3a0; }'});
  try {
    await clickKey(page);
    const got = await page.$eval('.pinkie-ckpt-modal .pinkie-ckpt-file', li => {
      const path = getComputedStyle(li.querySelector('.pinkie-ckpt-file__path'));
      const note = getComputedStyle(li.querySelector('.pinkie-ckpt-file__note'));
      return {pathBg: path.backgroundColor, radius: path.borderTopLeftRadius, noteColor: note.color, noteOpacity: note.opacity};
    });
    assert.deepEqual(got, {pathBg: 'rgba(96, 50, 73, 0.06)', radius: '5px', noteColor: 'rgb(118, 80, 100)', noteOpacity: '1'});
  } finally { await close(); }
});

const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = hex => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (a, b, t) => '#' + [1, 3, 5].map(i => Math.round(t * parseInt(a.slice(i, i + 2), 16) + (1 - t) * parseInt(b.slice(i, i + 2), 16)).toString(16).padStart(2, '0')).join('');
const noteInk = prefix => CSS.match(new RegExp(String.raw`^${prefix}\.pinkie-ckpt-modal \.pinkie-ckpt-file__note \{[^}]*?\bcolor:(#[0-9a-f]{6})`, 'm'))?.[1];

test('备注日间 / 夜间都 ≥4.5:1；反例：旧写法 #603249 × opacity .72 在日间弹窗底上不到 4.5', () => {
  const day = noteInk(''), night = noteInk('html\\[data-pinkie-night\\] ');
  assert.ok(day && night, `day=${day} night=${night}`);
  for (const bg of ['#fae2ef', '#f3d6e5']) assert.ok(ratio(day, bg) >= 4.5, `${day} 对 ${bg} 只有 ${ratio(day, bg).toFixed(2)}`);
  assert.ok(ratio(night, '#2a2027') >= 4.5, `${night} 对 #2a2027 只有 ${ratio(night, '#2a2027').toFixed(2)}`);
  assert.doesNotMatch(CSS.match(/\.pinkie-ckpt-file__note \{[^}]*\}/g).join(''), /opacity/);
  assert.ok(ratio(mix('#603249', '#fae2ef', 0.72), '#fae2ef') < 4.5);
});
