import test from 'node:test';
import assert from 'node:assert/strict';
import {withEarlyUserEcho, withMediaCaptionPlaceholder} from '../patch/apply-chat-timeline.mjs';

// A trimmed copy of the native send path, keeping the exact anchors.
const send = 'async function $h(e,o,c,s,a,l,d,u,m,send){try{let r=a.skillWorkshopRevision?await Bh(e,{}):await Rh(e,{message:o,attachments:c?s:void 0,runId:u,sessionKey:l,agentId:a.agentId});if(r.status===`error`)return`failed`;if(Vh(e,o,c?s:void 0,d,r.runId),r.status===`ok`)return`sent`;return`sent`}catch(r){let i=ls(r);return Yh(r,i)?(od(e),`pending`):`failed`}}';
const run = (source, rh) => Function('Vh', 'Rh', 'Bh', 'ls', 'Yh', 'od', `${source};return $h`)(
  (e, text, att, d, runId) => { const m = {role: 'user', text, att, runId}; e.chatMessages = [...e.chatMessages, m]; return m; },
  rh, async () => ({}), (r) => String(r), () => false, () => {});

test('the user bubble appears before a slow image upload is acknowledged, exactly once after it', async () => {
  const patched = withEarlyUserEcho(send);
  assert.match(patched, /pinkie-early-user-echo:v1/);
  assert.equal(withEarlyUserEcho(patched), patched, 'idempotent');
  const e = {chatMessages: []};
  let release, seenDuringUpload;
  const sendFn = run(patched, () => new Promise((resolve) => { seenDuringUpload = e.chatMessages.length; release = resolve; }));
  const done = sendFn(e, '看图', true, ['img'], {}, 'agent:project:dashboard:x', 1, 'run-1', () => true);
  await Promise.resolve();
  assert.equal(seenDuringUpload, 1, 'visible while the image uploads');
  release({status: 'ok', runId: 'run-1'});
  assert.equal(await done, 'sent');
  assert.equal(e.chatMessages.length, 1, 'no duplicate after the ack');
});

test('a failed send takes the early bubble away again', async () => {
  const sendFn = run(withEarlyUserEcho(send), async () => { throw new Error('offline'); });
  const e = {chatMessages: []};
  assert.equal(await sendFn(e, 'x', true, ['img'], {}, 'agent:project:dashboard:x', 1, 'run-2', () => true), 'failed');
  assert.equal(e.chatMessages.length, 0);
  const rejected = run(withEarlyUserEcho(send), async () => ({status: 'error', runId: 'run-3'}));
  const f = {chatMessages: []};
  assert.equal(await rejected(f, 'x', false, [], {}, 'agent:project:dashboard:x', 1, 'run-3', () => true), 'failed');
  assert.equal(f.chatMessages.length, 0);
});

test('the excluded mode keeps the native timing', async () => {
  const e = {chatMessages: []};
  let seen;
  const sendFn = run(withEarlyUserEcho(send), async () => { seen = e.chatMessages.length; return {status: 'ok', runId: 'r'}; });
  await sendFn(e, 'x', true, ['img'], {}, 'agent:unrestricted:dashboard:x', 1, 'r', () => true);
  assert.equal(seen, 0);
});

test('an image sent without words shows no placeholder caption', () => {
  const strip = 'function Tn(e){if(!e)return e;let t=e.replace(un,``);if(!vn.test(t))return t;return t}';
  const patched = withMediaCaptionPlaceholder(strip);
  assert.equal(withMediaCaptionPlaceholder(patched), patched);
  const Tn = Function('un', 'vn', `${patched};return Tn`)(/^x/, /never/);
  assert.equal(Tn('[User sent media without caption]'), '');
  assert.equal(Tn('看看这张 [User sent media without caption]'), '看看这张 [User sent media without caption]');
  assert.equal(Tn('你好'), '你好');
});

test('unknown native shapes are left untouched', () => {
  assert.equal(withEarlyUserEcho('function x(){}'), 'function x(){}');
  assert.equal(withMediaCaptionPlaceholder('function x(){}'), 'function x(){}');
});
