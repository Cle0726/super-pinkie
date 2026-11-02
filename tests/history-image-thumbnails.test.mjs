import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {transform, marker} from '../patch/apply-history-image-thumbnails.mjs';

const handler = `const CHAT_HISTORY_MAX_SINGLE_MESSAGE_BYTES = 400;
function jsonUtf8Bytes(v){return Buffer.byteLength(JSON.stringify(v));}
function replaceOversizedChatHistoryMessages(params) {
\treturn {messages: params.messages.map((m) => jsonUtf8Bytes(m) <= params.maxSingleMessageBytes ? m : {role: m.role, content: [{type: 'text', text: 'omitted'}]})};
}
async function history(historyPage, maxHistoryBytes) {
\tconst normalized = historyPage.messages;
\treturn replaceOversizedChatHistoryMessages({messages: normalized, maxSingleMessageBytes: Math.min(CHAT_HISTORY_MAX_SINGLE_MESSAGE_BYTES, maxHistoryBytes)}).messages;
}`;

// Evaluate the patched handler with a fake image sanitizer module.
async function load(source, sanitizer) {
  const dir = fs.mkdtempSync('/tmp/pinkie-thumb-');
  fs.writeFileSync(`${dir}/tool-images-test.js`, `export const t = ${sanitizer};`);
  fs.writeFileSync(`${dir}/chat.mjs`, `${source}\nexport {history};`);
  try { return (await import(`${dir}/chat.mjs`)).history; } finally { setTimeout(() => fs.rmSync(dir, {recursive: true, force: true}), 1000); }
}

test('an oversized user image becomes a thumbnail and the words stay', async () => {
  const patched = transform(handler, 'tool-images-test.js', 't');
  assert.match(patched, new RegExp(marker.replace(/[*/]/g, '\\$&')));
  assert.equal(transform(patched, 'tool-images-test.js', 't'), patched, 'idempotent');
  const history = await load(patched, `async (blocks) => blocks.map((b) => b.type === 'image' ? {type: 'image', mimeType: 'image/jpeg', data: 'x'} : b)`);
  const big = {role: 'user', __openclaw: {id: 'a'}, content: [{type: 'text', text: '这个是什么？'}, {type: 'image', mimeType: 'image/png', data: 'y'.repeat(2000)}]};
  const [out] = await history({messages: [big]}, 1e6);
  assert.deepEqual(out.content, [{type: 'text', text: '这个是什么？'}, {type: 'image', mimeType: 'image/jpeg', data: 'x'}]);
});

test('without an image processor the image is dropped but the text is kept', async () => {
  const history = await load(transform(handler, 'tool-images-test.js', 't'), `async () => { throw new Error('no processor'); }`);
  const big = {role: 'user', __openclaw: {id: 'b'}, content: [{type: 'text', text: '看图'}, {type: 'image', mimeType: 'image/png', data: 'y'.repeat(2000)}]};
  const [out] = await history({messages: [big]}, 1e6);
  assert.deepEqual(out.content, [{type: 'text', text: '看图'}]);
});

test('small messages and assistant messages are untouched', async () => {
  const history = await load(transform(handler, 'tool-images-test.js', 't'), `async () => { throw new Error('must not run'); }`);
  const small = {role: 'user', content: [{type: 'text', text: 'hi'}]};
  const [out] = await history({messages: [small]}, 1e6);
  assert.equal(out, small);
});

test('the installers apply it', () => {
  assert.match(fs.readFileSync(new URL('../installer/macos/apply-theme.sh', import.meta.url), 'utf8'), /apply-history-image-thumbnails\.mjs/);
  assert.match(fs.readFileSync(new URL('../installer/windows/apply-theme.ps1', import.meta.url), 'utf8'), /apply-history-image-thumbnails\.mjs/);
});

test('the transcript reader keeps an oversized user line without its inline image', async () => {
  const {readerHelper, transformReader, readerMarker} = await import('../patch/apply-history-image-thumbnails.mjs');
  const slimOf = Function(`${readerHelper};return pinkieSlimOversizedUserRecord`)();
  const line = JSON.stringify({type: 'message', id: 'u1', parentId: 'p', message: {role: 'user', MediaPath: '/x.png', content: [{type: 'text', text: '这个是什么？'}, {type: 'image', mimeType: 'image/png', data: 'z'.repeat(400000)}]}});
  const slim = slimOf(line);
  assert.deepEqual(slim.message.content, [{type: 'text', text: '这个是什么？'}, {type: 'image', mimeType: 'image/png', pinkieDataOnDisk: true}]);
  assert.equal(slim.message.MediaPath, '/x.png');
  assert.equal(slimOf(JSON.stringify({message: {role: 'assistant', content: [{type: 'image', data: 'z'}]}})), null);
  const reader = 'function buildOversizedIndexedRawEntry(params) {\n\treturn null;\n}\nfunction buildOversizedTranscriptRecord(line) {\n\treturn null;\n}\n';
  const patched = transformReader(reader);
  assert.ok(patched.includes(readerMarker));
  assert.equal(transformReader(patched), patched);
});
