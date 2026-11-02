import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CompletionIntegrityGuard} from '../services/mode-architecture/index.mjs';

// Two nudges that each fire at most once per turn: look at a finished
// deliverable before calling it done, and do the work instead of announcing it.
function setup(t, prompt) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-soft-gates-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const guard = new CompletionIntegrityGuard();
  const ctx = {agentId: 'thinking', sessionKey: `agent:thinking:${path.basename(root)}`, runId: 'r1'};
  guard.begin({prompt}, ctx);
  return {root, guard, ctx};
}
function produce(guard, ctx, id, command, file, content = 'bytes') {
  guard.beforeTool({toolName: 'exec', toolCallId: id, params: {command}}, ctx);
  fs.writeFileSync(file, content);
  guard.afterTool({toolName: 'exec', toolCallId: id, params: {command}, result: 'ok'}, ctx);
}

test('a finished video must be looked at once before it is called done', (t) => {
  const {root, guard, ctx} = setup(t, '帮我做一个 4 分钟的爱情故事视频');
  const video = path.join(root, 'love.mp4');
  produce(guard, ctx, 'render', `ffmpeg -y -i frames/%04d.png "${video}"`, video);
  guard.afterTool({toolName: 'exec', toolCallId: 'probe', params: {command: `ffprobe "${video}"`}, result: 'Duration: 00:04:00'}, ctx);
  const reply = '视频已经全部完成，时长 4 分钟。';
  const first = guard.finalize({lastAssistantMessage: reply}, ctx, {verifyExternal: false});
  assert.equal(first?.action, 'revise');
  assert.match(first.reason, /没有亲自看过成品内容/);
  assert.match(first.reason, /look-video/);
  // The transcript hook and the finalize hook judge the same reply: same answer.
  assert.equal(guard.finalize({lastAssistantMessage: reply}, ctx, {verifyExternal: false})?.action, 'revise');

  const preview = path.join(root, 'love.preview.png');
  guard.afterTool({toolName: 'exec', toolCallId: 'look', params: {command: `look-video "${video}"`}, result: 'ok'}, ctx);
  guard.afterTool({toolName: 'read', toolCallId: 'see', params: {path: preview}, result: 'image'}, ctx);
  const after = guard.finalize({lastAssistantMessage: '看过预览，视频已经全部完成。'}, ctx, {verifyExternal: false});
  assert.notEqual(after?.action, 'revise', after?.reason);
});

test('the inspection nudge fires only once per turn', (t) => {
  const {root, guard, ctx} = setup(t, '帮我生成一张海报图片');
  const poster = path.join(root, 'poster.png');
  produce(guard, ctx, 'draw', `python3 draw.py --out "${poster}"`, poster);
  guard.afterTool({toolName: 'exec', toolCallId: 'ls', params: {command: `ls -la "${poster}"`}, result: 'poster.png'}, ctx);
  assert.equal(guard.finalize({lastAssistantMessage: '海报已经生成完成。'}, ctx, {verifyExternal: false})?.action, 'revise');
  const second = guard.finalize({lastAssistantMessage: '海报已经做好了，全部完成。'}, ctx, {verifyExternal: false});
  assert.notEqual(second?.action, 'revise', 'a model that still does not look is not trapped in a retry loop');
});

test('documents pass with a text check; ordinary HTML code edits are not treated as pages', (t) => {
  const {root, guard, ctx} = setup(t, '帮我做一份周报 PPT');
  const deck = path.join(root, 'weekly.pptx');
  produce(guard, ctx, 'deck', `python3 make_deck.py "${deck}"`, deck);
  guard.afterTool({toolName: 'exec', toolCallId: 'text', params: {command: `markitdown "${deck}"`}, result: '# 周报'}, ctx);
  assert.notEqual(guard.finalize({lastAssistantMessage: '周报 PPT 已经完成。'}, ctx, {verifyExternal: false})?.action, 'revise');

  const code = setup(t, '把登录按钮的文字改成“进入”');
  const html = path.join(code.root, 'index.html');
  fs.writeFileSync(html, '<button>登录</button>');
  code.guard.beforeTool({toolName: 'write', toolCallId: 'w', params: {path: html}}, code.ctx);
  fs.writeFileSync(html, '<button>进入</button>');
  code.guard.afterTool({toolName: 'write', toolCallId: 'w', params: {path: html}, result: {ok: true}}, code.ctx);
  code.guard.afterTool({toolName: 'read', toolCallId: 'r', params: {path: html}, result: '<button>进入</button>'}, code.ctx);
  const edited = code.guard.finalize({lastAssistantMessage: '按钮文字已经改好了，完成。'}, code.ctx, {verifyExternal: false});
  assert.doesNotMatch(edited?.reason || '', /没有亲自看过成品内容/);
});

test('announcing the work and stopping is sent back once; waiting on the user is not', (t) => {
  const {guard, ctx} = setup(t, '帮我把这个视频剪成 30 秒');
  guard.afterTool({toolName: 'exec', toolCallId: 'probe', params: {command: 'ffprobe in.mp4'}, result: 'Duration: 00:02:00'}, ctx);
  const promise = '素材碧琪看过了，碧琪这就去剪，稍等～';
  const first = guard.finalize({lastAssistantMessage: promise}, ctx, {verifyExternal: false});
  assert.equal(first?.action, 'revise');
  assert.match(first.reason, /不要只预告/);
  assert.equal(guard.finalize({lastAssistantMessage: promise}, ctx, {verifyExternal: false})?.action, 'revise');
  assert.doesNotMatch(guard.finalize({lastAssistantMessage: '碧琪马上开始剪。'}, ctx, {verifyExternal: false})?.reason || '', /不要只预告/);

  const waiting = setup(t, '帮我把这个视频剪成 30 秒');
  waiting.guard.afterTool({toolName: 'exec', toolCallId: 'probe', params: {command: 'ffprobe in.mp4'}, result: 'ok'}, waiting.ctx);
  for (const reply of ['需要先生确认保留哪一段，确认后碧琪马上开始剪。', '要剪掉开头还是结尾？碧琪等先生选好就动手。']) {
    assert.doesNotMatch(waiting.guard.finalize({lastAssistantMessage: reply}, waiting.ctx, {verifyExternal: false})?.reason || '', /不要只预告/);
  }
});

test('a turn that presented or graded a learning card is delivered without file evidence', (t) => {
  for (const prompt of ['专升本：给我出 3 道 C 语言循环和数组的题，要有程序阅读题',
    '[[CLEKK_LEARNING_ANSWER_V1]] activity_id: q1 item_id: zsb-c6-80 answer: "4"\n请只对这一小题调用 learning_activity resolve，使用 item_results 并保留 item_id，给出简短讲解和具体错因。',
    // The host appends mode context to the prompt; its “运行练习” is not the user's request.
    '[[CLEKK_LEARNING_START_V1]] 调用 learning_activity present 出一道互动题。\n\n【学习工作台】先生可以一边学习，一边在左边的编辑器和终端里查看资料、编写并运行练习。']) {
    const {guard, ctx} = setup(t, prompt);
    guard.afterTool({toolName: 'learning_activity', toolCallId: 'card', params: {action: 'present'}, result: 'ok'}, ctx);
    assert.equal(guard.finalize({lastAssistantMessage: '题卡已经出好，直接作答就行。'}, ctx, {verifyExternal: false}), undefined, prompt);
  }
  // Asking for a file still needs the file.
  const {guard, ctx} = setup(t, '出 3 道题并保存成文件');
  guard.afterTool({toolName: 'learning_activity', toolCallId: 'card', params: {action: 'present'}, result: 'ok'}, ctx);
  assert.equal(guard.finalize({lastAssistantMessage: '已经全部完成。'}, ctx, {verifyExternal: false})?.action, 'revise');
});

// 工作台插件把【工作台】说明接在每条项目消息后面（2026-11-01 实测：「你是什么模型？」因此被当成
// 执行型请求打回重写，多花一轮、聊天记录里先生那句也被改写掉）。
const WORKBENCH = '\n\n【工作台】先生可以使用 VS Code 式工作台和你一起写代码（左边编辑器、终端，右边是你）。写或改完代码，用 code_check 做真实检查（类型、语法、编译），有错误就继续修，直到没有错误再交付；能运行的就运行或跑测试确认。\n当前项目/默认工作目录："/tmp/x"';
test('the workbench note appended to a question does not turn it into an execution request', (t) => {
  for (const question of ['你是什么模型？', '给我的奶茶店想个名字']) {
    const {guard, ctx} = setup(t, question + WORKBENCH);
    assert.equal(guard.finalize({lastAssistantMessage: '我是碧琪，由 Gemini 3.8 Flash 驱动。'}, ctx, {verifyExternal: false}), undefined);
  }
  const {guard, ctx} = setup(t, '帮我做个记账的网页' + WORKBENCH);
  const decision = guard.finalize({lastAssistantMessage: '记账页做好了。'}, ctx, {verifyExternal: false});
  assert.equal(decision?.action, 'revise', 'a real build request still needs execution evidence');
  assert.match(decision.reason, /执行型请求/);
});
