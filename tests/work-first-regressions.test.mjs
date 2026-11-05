import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CompletionIntegrityGuard, CleKkSupervisor, CleKkAuditLog, UpstreamWatchdog, sessionCheckpointRelative} from '../services/mode-architecture/index.mjs';
import {validateDeliveryFile} from '../services/mode-architecture/file-delivery.mjs';
import {workFirstMediaPayload, transformWithStatus as mediaPatch} from '../patch/apply-work-first-media-gate.mjs';
import {workFirstDeliveryMessages, transformWithStatus as chatPatch} from '../patch/apply-work-first-chat.mjs';

function setup(t, prompt, agent = 'project') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-work-first-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const ctx = {agentId: agent, sessionKey: `agent:${agent}:${path.basename(root)}`, runId: 'first'};
  const guard = new CompletionIntegrityGuard();
  guard.begin({prompt}, ctx);
  return {root, ctx, guard};
}

test('naming and prose are answers; explicitly requested files still need evidence', t => {
  for (const prompt of ['给我的奶茶店想个名字', '帮我写段话发朋友圈，今天升职了', '帮我排一下复习计划']) {
    const {guard, ctx} = setup(t, prompt);
    assert.equal(guard.finalize({lastAssistantMessage: '写好了，推荐用「慢半拍」，名字好记，也让人想坐下来喝一杯。'}, ctx, {verifyExternal: false}), undefined);
  }
  const {guard, ctx} = setup(t, '给奶茶店想个名字并保存到名字.txt');
  assert.equal(guard.finalize({lastAssistantMessage: '已经写入文件并完成。'}, ctx, {verifyExternal: false})?.action, 'revise');
  const logo = setup(t, '给奶茶店想个名字，并做个 logo');
  assert.equal(logo.guard.finalize({lastAssistantMessage: '名字和 logo 已经生成完成。'}, logo.ctx, {verifyExternal:false})?.action, 'revise');
  const skill = setup(t, '调用 Skill 给奶茶店想个名字');
  assert.equal(skill.guard.finalize({lastAssistantMessage: '推荐「慢半拍」，名字好记，也有松弛感。'}, skill.ctx, {verifyExternal:false})?.action, 'revise');
});

test('a fragment after work is nudged once; concise verified completions remain valid', t => {
  const {guard, ctx} = setup(t, '帮我排一下复习计划');
  for (let i = 0; i < 3; i++) guard.afterTool({toolName: 'read', toolCallId: `read-${i}`, params: {path: `/tmp/notes-${i}`}, result: 'notes'}, ctx);
  assert.match(guard.finalize({lastAssistantMessage: '碧'}, ctx, {verifyExternal: false})?.reason, /过短|截断/);
  assert.equal(guard.finalize({lastAssistantMessage: '复习计划写好了：每天复习数学和英语，周末回顾错题。'}, ctx, {verifyExternal: false}), undefined);
  const chat = setup(t, '你好');
  assert.equal(chat.guard.finalize({lastAssistantMessage: '好'}, chat.ctx, {verifyExternal: false}), undefined);
});

test('checking off the checkpoint does not invalidate a checked artifact', t => {
  const {root, guard, ctx} = setup(t, '帮我创建项目文件');
  const artifact = path.join(root, 'answer.txt');
  const note = path.join(root, sessionCheckpointRelative(ctx.sessionKey));
  fs.mkdirSync(path.dirname(note), {recursive: true});
  for (const [file, id] of [[artifact, 'artifact'], [note, 'checkpoint']]) {
    guard.beforeTool({toolName: 'write', toolCallId: id, params: {path: file}}, ctx);
    fs.writeFileSync(file, id);
    guard.afterTool({toolName: 'write', toolCallId: id, params: {path: file}, result: {ok: true}}, ctx);
    if (id === 'artifact') guard.afterTool({toolName: 'read', toolCallId: 'check', params: {path: file}, result: 'artifact'}, ctx);
  }
  assert.equal(guard.finalize({lastAssistantMessage: '文件已完成并检查，结果在 answer.txt。'}, ctx, {verifyExternal: false}), undefined);
  const foreign = path.join(root, 'memory/context/sessions/some-other-session.md');
  guard.beforeTool({toolName:'write',toolCallId:'foreign',params:{path:foreign}},ctx);
  fs.writeFileSync(foreign,'a different session file');
  guard.afterTool({toolName:'write',toolCallId:'foreign',params:{path:foreign},result:{ok:true}},ctx);
  assert.equal(guard.finalize({lastAssistantMessage:'文件已完成并检查。'},ctx,{verifyExternal:false})?.action,'revise');
});

test('an async media handoff retains the original user objective and evidence', t => {
  const {root, ctx} = setup(t, '给奶茶店想个名字');
  const supervisor = new CleKkSupervisor({audit: new CleKkAuditLog(path.join(root, 'audit'))});
  supervisor.begin({prompt: '给奶茶店想个名字'}, ctx);
  supervisor.afterTool({toolName: 'image_generate', toolCallId: 'image', result: 'Background task started for image generation'}, ctx);
  const event = {success: true, messages: [
    {role: 'assistant', stopReason: 'toolUse'},
    {role: 'toolResult', content: 'Background task started for image generation'},
  ]};
  assert.equal(supervisor.end(event, ctx), false);
  supervisor.begin({prompt: 'A background task completed. Use this result to reply to the user in your normal assistant voice.\nsource: image_generation\nresult: done'}, {...ctx, runId: 'media-result'});
  const state = supervisor.integrity.runs.get(ctx.sessionKey);
  assert.equal(state.prompt, '给奶茶店想个名字');
  assert.equal(state.tools.length, 1);
});

test('a late end from an older run cannot resume after a newer answer', async t => {
  const {ctx} = setup(t, '想个名字');
  const watchdog = new UpstreamWatchdog({}, () => '', async () => {throw Error('must not retry');}, 'not-used');
  watchdog.modelStarted({sessionKey: ctx.sessionKey, runId: 'newer', provider: 'test', model: 'test'});
  assert.equal(await watchdog.agentEnded({success: true, runId: 'older', messages: [{role: 'assistant', stopReason: 'toolUse'}]}, ctx), false);
  assert.equal(watchdog.timers.size, 0);
});

test('a running image task outranks the non-deliverable marker in work-first modes only', async () => {
  const queued = [];
  const api = {session: {workflow: {
    enqueueNextTurnInjection: async entry => { queued.push(entry.sessionKey); },
    unscheduleSessionTurnsByTag: async () => {},
  }}};
  const watchdog = new UpstreamWatchdog(api, () => '', async () => {throw Error('no cli');}, 'not-used');
  watchdog.scheduleImmediate = () => {};
  const waiting = (runId, content = 'Background task started for image generation') => ({success: true, runId, outcome: 'non_deliverable_terminal_turn', messages: [
    {role: 'assistant', stopReason: 'toolUse'},
    {role: 'toolResult', content},
  ]});
  const project = {agentId: 'project', sessionKey: 'agent:project:media'};
  assert.equal(await watchdog.agentEnded(waiting('media'), project), false);
  assert.equal(await watchdog.agentEnded(waiting('plain', 'ok'), {agentId: 'project', sessionKey: 'agent:project:plain'}), true);
  assert.equal(await watchdog.agentEnded(waiting('legacy'), {agentId: 'unrestricted', sessionKey: 'agent:unrestricted:media'}), true);
  assert.deepEqual(queued, ['agent:project:plain', 'agent:unrestricted:media']);
});

test('local HTML stays a browser deliverable and is not auto-attached', t => {
  const {root} = setup(t, '做个网页');
  const html = path.join(root, 'index.html'), png = path.join(root, 'shot.png');
  fs.writeFileSync(html, '<title>preview</title>'); fs.writeFileSync(png, 'png');
  const opts = {homeDirectory: root, startedAt: 0};
  assert.equal(validateDeliveryFile(html, opts), null);
  assert.equal(validateDeliveryFile(png, opts), fs.realpathSync(png));
});

test('a rejected final cannot escape via a media mirror; unrestricted is untouched', () => {
  const payload = {text: 'done', mediaUrls: ['/tmp/shot.png']};
  assert.equal(workFirstMediaPayload(payload, {kind: 'final'}, 'agent:project:test', 'project', () => null), null);
  assert.equal(workFirstMediaPayload(payload, {kind: 'block'}, 'agent:project:test', 'project', () => null), null);
  assert.equal(workFirstMediaPayload(payload, {kind: 'final'}, 'agent:unrestricted:test', 'unrestricted', () => {throw Error('unrestricted');}), payload);
  assert.equal(workFirstMediaPayload(payload, {kind: 'tool'}, 'agent:project:test', 'project', () => {throw Error('tool');}), payload);
  assert.equal(mediaPatch('unknown').reason, 'unsupported-runtime');
  assert.equal(chatPatch('unknown').reason, 'unsupported-ui');
});

test('only an adjacent media mirror replaces native text; identical user turns survive', () => {
  const native = {role: 'assistant', provider: 'mm', stopReason: 'stop', timestamp: 1000, content: '成品已完成。\nMEDIA:/tmp/shot.png'};
  const mirror = {role: 'assistant', provider: 'openclaw', model: 'gateway-injected', idempotencyKey: 'run:assistant-media', timestamp: 2000,
    content: [{type: 'text', text: '成品已完成。'}, {type: 'image', url: 'shot'}]};
  const options = {sessionKey: 'agent:project:test'};
  assert.deepEqual(workFirstDeliveryMessages([native, mirror], options), [mirror]);
  const user = {role: 'user', content: '继续'};
  assert.deepEqual(workFirstDeliveryMessages([native, user, user, mirror], options), [native, user, user, mirror]);
  assert.deepEqual(workFirstDeliveryMessages([native, {...mirror, content: '不同回复'}], options), [native, {...mirror, content: '不同回复'}]);
  assert.deepEqual(workFirstDeliveryMessages([native, mirror], {sessionKey: 'agent:unrestricted:test'}), [native, mirror]);
});


test('background cleanup may stay silent without the fragment nudge', t => {
  const {guard, ctx} = setup(t, '帮我排一下复习计划');
  for (let i=0;i<3;i++) guard.afterTool({toolName:'read',toolCallId:`read-${i}`,params:{path:`/tmp/notes-${i}`},result:'notes'},ctx);
  assert.equal(guard.finalize({lastAssistantMessage:'NO_REPLY'},ctx,{verifyExternal:false}),undefined);
});

test('a pre-compaction memory flush between a rejected delivery and its retry keeps the task evidence', t => {
  // 11-04 routes-m R-ad: the delivery was sent back for its sources; before the retry ran, the runtime
  // inserted a memory-flush turn (transcript: "Continue the OpenClaw runtime event."). It was taken for a new
  // user message, the evidence window was wiped, and the retry was then told it never looked at the video.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-flush-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  for (const flushCtx of [{trigger: 'memory'}, {}]) {
    const key = `agent:thinking:flush-${flushCtx.trigger || 'prompt-only'}`;
    const ctx = {agentId: 'thinking', sessionKey: key, runId: 'deliver'};
    const supervisor = new CleKkSupervisor({audit: new CleKkAuditLog(path.join(root, `audit-${flushCtx.trigger || 'p'}`)), integrity: new CompletionIntegrityGuard()});
    supervisor.begin({prompt: '剪一个 15 秒的竖屏抖音广告，卖我们店新出的桂花拿铁，出 MP4 给我'}, ctx);
    const video = path.join(root, `ad-${flushCtx.trigger || 'p'}.mp4`);
    supervisor.beforeTool({toolName: 'exec', toolCallId: 'dl', runId: 'deliver', params: {command: 'python3 -c "import urllib.request; urllib.request.urlretrieve(\'https://images.unsplash.com/photo-1\', \'assets/cup.jpg\')"'}}, ctx);
    supervisor.afterTool({toolName: 'exec', toolCallId: 'dl', runId: 'deliver', params: {command: 'python3 -c "import urllib.request; urllib.request.urlretrieve(\'https://images.unsplash.com/photo-1\', \'assets/cup.jpg\')"'}, result: 'ok'}, ctx);
    supervisor.beforeTool({toolName: 'exec', toolCallId: 'render', runId: 'deliver', params: {command: `ffmpeg -y -i frames/%04d.png "${video}"`}}, ctx);
    fs.writeFileSync(video, 'mp4');
    supervisor.afterTool({toolName: 'exec', toolCallId: 'render', runId: 'deliver', params: {command: `ffmpeg -y -i frames/%04d.png "${video}"`}, result: 'ok'}, ctx);
    supervisor.afterTool({toolName: 'exec', toolCallId: 'look', runId: 'deliver', params: {command: `look-video "${video}" 12`}, result: 'ok'}, ctx);
    supervisor.afterTool({toolName: 'read', toolCallId: 'see', runId: 'deliver', params: {path: video.replace(/\.mp4$/, '.preview.png')}, result: 'image'}, ctx);
    const delivered = {lastAssistantMessage: `广告已经剪好，可以直接发抖音。\n\nMEDIA:${video}`};
    const rejected = supervisor.recordFinalize(delivered, ctx, supervisor.finalizeDecision(delivered, ctx, {verifyExternal: false}));
    assert.equal(rejected?.action, 'revise');
    assert.match(rejected.reason, /素材从哪来/);
    assert.match(rejected.reason, /images\.unsplash\.com/, 'the reminder names the download it can see');

    // The runtime's own memory flush. before_message_write carries no run id.
    const flush = {...ctx, ...flushCtx, runId: 'flush'};
    supervisor.begin({prompt: flushCtx.trigger ? 'Continue the OpenClaw runtime event.' : 'Pre-compaction memory flush. Store durable memories now.'}, flush);
    supervisor.afterTool({toolName: 'write', toolCallId: 'mem', runId: 'flush', params: {path: 'memory/2026-11-04.md', content: '- 桂花拿铁广告'}, result: 'Appended'}, flush);
    supervisor.beforeMessageWrite({message: {role: 'assistant', stopReason: 'stop', content: [{type: 'text', text: 'NO_REPLY'}]}}, {sessionKey: key});
    supervisor.recordFinalize({lastAssistantMessage: 'NO_REPLY'}, flush, supervisor.finalizeDecision({lastAssistantMessage: 'NO_REPLY'}, flush, {verifyExternal: false}));
    assert.equal(supervisor.end({success: true, messages: [{role: 'assistant', stopReason: 'stop', content: 'NO_REPLY'}]}, flush), false);
    assert.ok(supervisor.hasPending(key), 'the rejected delivery still waits for its retry');
    const state = supervisor.integrity.runs.get(key);
    assert.ok(state.tools.some(entry => /look-video/.test(String(entry.params?.command || ''))), 'evidence survives the flush');
    assert.ok(!state.tools.some(entry => entry.name === 'write'), 'the flush\'s own memory write is not task evidence');

    // The retry: adds the sources and is accepted without a false "never looked at it".
    const retry = {...ctx, runId: 'retry'};
    supervisor.begin({prompt: '⁣[pinkie-watchdog] 交付前提醒（只提醒这一次）：交付的视频没说清素材从哪来。'}, retry);
    supervisor.afterTool({toolName: 'exec', toolCallId: 'probe', runId: 'retry', params: {command: `ffprobe "${video}"`}, result: 'Duration: 00:00:15'}, retry);
    const fixed = {lastAssistantMessage: `广告已经剪好。画面是从 Unsplash 图库下载的（可免费商用），配乐来自免版税曲库，配音是本机语音合成；换成你们店的实拍再发更好。\n\nMEDIA:${video}`};
    assert.notEqual(supervisor.finalizeDecision(fixed, retry, {verifyExternal: false})?.action, 'revise');
  }
});

test('a runtime-event turn continues an open task instead of opening a new evidence window', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-runtime-event-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const key = 'agent:project:runtime-event';
  const ctx = {agentId: 'project', sessionKey: key, runId: 'one'};
  const supervisor = new CleKkSupervisor({audit: new CleKkAuditLog(root), integrity: new CompletionIntegrityGuard()});
  supervisor.begin({prompt: '帮我做一份 8 页左右的 PPT，出 pptx 文件给我'}, ctx);
  supervisor.afterTool({toolName: 'exec', toolCallId: 'build', runId: 'one', params: {command: 'python3 build_deck.py'}, result: 'ok'}, ctx);
  const draft = {lastAssistantMessage: 'PPT 已经做好了，共 8 页。'};
  supervisor.recordFinalize(draft, ctx, {action: 'revise', reason: '全局交付真实性门禁：本轮做出了演示文稿，但做完之后没有亲自看过'});
  assert.ok(supervisor.hasPending(key));
  supervisor.begin({prompt: 'Continue the OpenClaw runtime event.'}, {...ctx, runId: 'event'});
  assert.ok(supervisor.integrity.runs.get(key).tools.some(entry => entry.name === 'exec'), 'evidence kept');
  // A genuinely new request from 先生 still opens a fresh window.
  supervisor.begin({prompt: '再帮我写一段开业致辞'}, {...ctx, runId: 'two'});
  assert.equal(supervisor.integrity.runs.get(key)?.tools.length || 0, 0);
});
