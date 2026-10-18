import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apply, transform} from '../patch/apply-control-ui-file-delivery.mjs';

// OpenClaw 2026.10 chat renderer shape (control-ui-boot-chat-*.js): ld() is
// imported, attachments render through hc(), the bubble template is `U`.
const current = 'function p_(e,t,n,r){let{images:y,attachments:b,orderedContent:C,supplementalImages:w,supplementalAttachments:T}=ld(a,o.content);'
  + 'let D=p===`user`?b.filter((e=>e.type===`attachment`&&e.attachment.kind===`video`)):[],O=b.filter(e=>!D.includes(e));'
  + 'let F=[`chat-bubble`,D.length>0?`chat-bubble--with-images`:``,`chat-bubble--with-files`].filter(Boolean).join(` `);'
  + 'return U`\n    <div class="chat-bubble ${F}">\n    ${zu(te)}\n    ${hc(le?T:O,A,r,n.onAssistantAttachmentLoaded,p===`assistant`)}\n    ${g?be:K}\n  </div>`}';

test('2026.10 renders a local deliverable as a card and keeps remote media', () => {
  const output = transform(current);
  assert.notEqual(output, current);
  assert.match(output, /pinkie-control-ui-file-delivery:v2/);
  // helper block is injected once, with the bundle's own lit tag
  assert.equal((output.match(/function laolaoDeliveryPath\(/gu) || []).length, 1);
  assert.match(output, /return U`<div class="chat-assistant-attachment-card laolao-delivery-card"/);
  // video preview and attachment strip skip local deliverables
  assert.match(output, /e\.attachment\.kind===`video`&&!laolaoDeliveryPath\(e\.attachment\.url\)/);
  assert.match(output, /\$\{hc\(le\?T:O\.filter\(e=>!laolaoDeliveryPath\(e\?\.attachment\?\.url\)\),A,r,n\.onAssistantAttachmentLoaded,/);
  // cards are rendered next to the message toasts
  assert.match(output, /\$\{laolaoDeliveryCards\(laolaoDeliveryItems\(O\),zu\(te\)\)\}/);
  assert.equal(transform(output), output, 'idempotent');
});

test('delivery helper only recognises user-home files', () => {
  const output = transform(current);
  const start = output.indexOf('function laolaoDeliveryPath');
  const end = output.indexOf('function p_(');
  const helpers = output.slice(start, end);
  const api = new Function(`const U = () => '';\n${helpers};return {laolaoDeliveryPath, laolaoDeliveryItems};`)();
  assert.equal(api.laolaoDeliveryPath('/Users/ada/Desktop/report.pdf'), '/Users/ada/Desktop/report.pdf');
  assert.equal(api.laolaoDeliveryPath('file:///Users/ada/Documents/a%20b.docx'), '/Users/ada/Documents/a b.docx');
  assert.equal(api.laolaoDeliveryPath('/Users/ada/.openclaw/media/inbound/x.png'), null);
  assert.equal(api.laolaoDeliveryPath('https://example.com/a.pdf'), null);
  assert.equal(api.laolaoDeliveryPath('~/Downloads/x.zip'), '~/Downloads/x.zip');
  const items = api.laolaoDeliveryItems([
    {attachment: {url: '/Users/ada/a.pdf', kind: 'document', label: 'a.pdf'}},
    {attachment: {url: '/Users/ada/a.pdf', kind: 'document', label: 'dup'}},
    {attachment: {url: 'https://x/y.png', kind: 'image', label: 'remote'}},
  ]);
  assert.equal(items.length, 1);
});

test('2026.10 picks the chat renderer chunk and refreshes its precompressed twins', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-delivery-'));
  try {
    const ui = path.join(root, 'dist/control-ui'), assets = path.join(ui, 'assets');
    fs.mkdirSync(assets, {recursive: true});
    const chat = path.join(assets, 'control-ui-boot-chat-TEST.js');
    fs.writeFileSync(chat, current);
    fs.writeFileSync(path.join(assets, 'control-ui-boot-chat-styles-TEST.js'), 'export{};');
    fs.writeFileSync(path.join(assets, 'chat-page-OLD.js'), 'old');
    const result = apply(root, {backupRoot: path.join(root, 'backup')});
    assert.equal(result.changed, true);
    assert.equal(result.file, 'control-ui-boot-chat-TEST.js');
    assert.match(fs.readFileSync(chat, 'utf8'), /pinkie-control-ui-file-delivery:v2/);
    assert.equal(fs.readFileSync(path.join(assets, 'control-ui-boot-chat-styles-TEST.js'), 'utf8'), 'export{};');
    assert.equal(apply(root, {backupRoot: path.join(root, 'backup')}).changed, false);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
