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

test('a video built from generated or downloaded assets must say where they came from; editing the user\'s own clip need not', (t) => {
  // 11-04 R-ad: image_generate pictures + edge-tts voice + synthesized music, delivered without a word about sources.
  const {root, guard, ctx} = setup(t, '剪一个 15 秒的竖屏抖音广告，卖我们店新出的桂花拿铁，出 MP4 给我');
  guard.afterTool({toolName: 'image_generate', toolCallId: 'img', params: {prompt: 'latte'}, result: 'Background task started'}, ctx);
  guard.afterTool({toolName: 'exec', toolCallId: 'tts', params: {command: 'edge-tts --voice zh-CN-XiaoxiaoNeural --text 秋天 --write-media vo.mp3'}, result: 'ok'}, ctx);
  const video = path.join(root, 'ad.mp4');
  produce(guard, ctx, 'render', `ffmpeg -y -i frames/%04d.png -i vo.mp3 "${video}"`, video);
  guard.afterTool({toolName: 'exec', toolCallId: 'look', params: {command: `look-video "${video}" 9`}, result: 'ok'}, ctx);
  guard.afterTool({toolName: 'read', toolCallId: 'see', params: {path: path.join(root, 'ad.preview.png')}, result: 'image'}, ctx);
  const silent = guard.finalize({lastAssistantMessage: '15 秒竖屏广告已经完成：1080×1920，30fps，H.264 + AAC。'}, ctx, {verifyExternal: false});
  assert.equal(silent?.action, 'revise');
  assert.match(silent.reason, /素材从哪来.+能不能商用/);
  assert.doesNotMatch(silent.reason, /没有亲自看过/, 'it did look; only the sources are missing');

  const told = setup(t, '剪一个 15 秒的竖屏抖音广告，卖我们店新出的桂花拿铁，出 MP4 给我');
  told.guard.afterTool({toolName: 'image_generate', toolCallId: 'img', params: {prompt: 'latte'}, result: 'Background task started'}, told.ctx);
  const ad2 = path.join(told.root, 'ad.mp4');
  produce(told.guard, told.ctx, 'render', `ffmpeg -y -i frames/%04d.png "${ad2}"`, ad2);
  told.guard.afterTool({toolName: 'read', toolCallId: 'see', params: {path: path.join(told.root, 'ad.preview.png')}, result: 'image'}, told.ctx);
  const ok = told.guard.finalize({lastAssistantMessage: '广告已经完成。画面是 AI 生成的普通拿铁，换成你们店的实拍再发；配音是 edge-tts 晓晓，可以商用。'}, told.ctx, {verifyExternal: false});
  assert.notEqual(ok?.action, 'revise', ok?.reason);

  // routes-e: the picture came from an earlier turn, the voice from Python calling say, the music was copied in.
  const quiet = setup(t, '剪一个 15 秒的竖屏抖音广告，卖我们店新出的桂花拿铁，出 MP4 给我');
  quiet.guard.afterTool({toolName: 'exec', toolCallId: 'cp', params: {command: 'cp ../old/bgm_15s.wav assets/'}, result: ''}, quiet.ctx);
  const ad3 = path.join(quiet.root, 'ad.mp4');
  produce(quiet.guard, quiet.ctx, 'render', `python3 render_video_15s.py "${ad3}"`, ad3);
  quiet.guard.afterTool({toolName: 'read', toolCallId: 'see', params: {path: path.join(quiet.root, 'ad.preview.png')}, result: 'image'}, quiet.ctx);
  const q = quiet.guard.finalize({lastAssistantMessage: '15 秒广告已经完成，1080×1920。'}, quiet.ctx, {verifyExternal: false});
  assert.equal(q?.action, 'revise');
  assert.match(q.reason, /素材从哪来/);

  // routes-f: a nudge to swap in real footage is not a statement of where the footage came from.
  const vague = setup(t, '剪一个 15 秒的竖屏抖音广告，卖我们店新出的桂花拿铁，出 MP4 给我');
  const ad4 = path.join(vague.root, 'ad.mp4');
  produce(vague.guard, vague.ctx, 'render', `python3 render.py "${ad4}"`, ad4);
  vague.guard.afterTool({toolName: 'read', toolCallId: 'see', params: {path: path.join(vague.root, 'ad.preview.png')}, result: 'image'}, vague.ctx);
  const v = vague.guard.finalize({lastAssistantMessage: '成片已经剪好，可以直接发抖音。配音与暖调 Lo-Fi 爵士伴奏混音。小建议：店里有高清实拍拿铁特写就发给我替换。'}, vague.ctx, {verifyExternal: false});
  assert.equal(v?.action, 'revise');
  assert.match(v.reason, /素材从哪来/);

  const own = setup(t, '帮我把这个视频剪成 30 秒');
  const cut = path.join(own.root, 'cut.mp4');
  produce(own.guard, own.ctx, 'cut', `ffmpeg -y -ss 0 -t 30 -i in.mp4 "${cut}"`, cut);
  own.guard.afterTool({toolName: 'read', toolCallId: 'see', params: {path: path.join(own.root, 'cut.preview.png')}, result: 'image'}, own.ctx);
  assert.notEqual(own.guard.finalize({lastAssistantMessage: '剪好了，30 秒，已经完成。'}, own.ctx, {verifyExternal: false})?.action, 'revise');
});

test('a turn opened by a background completion event is judged against the user\'s last real request', (t) => {
  // routes-g: the delivering turn began with the image_generate completion event, so it was not an action request.
  const {root, guard, ctx} = setup(t, '剪一个 15 秒的竖屏抖音广告，卖我们店新出的桂花拿铁，出 MP4 给我');
  guard.finalize({lastAssistantMessage: '正在生成画面，生成好碧琪继续。'}, ctx, {verifyExternal: false});
  guard.end({}, ctx);
  guard.begin({prompt: '<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>\n[Internal task completion event]\nsource: image_generation\nstatus: failed'}, ctx);
  const video = path.join(root, 'ad.mp4');
  produce(guard, ctx, 'render', `python3 render.py "${video}"`, video);
  guard.afterTool({toolName: 'read', toolCallId: 'see', params: {path: path.join(root, 'ad.preview.png')}, result: 'image'}, ctx);
  const v = guard.finalize({lastAssistantMessage: '成片已经剪好，可以直接发抖音。'}, ctx, {verifyExternal: false});
  assert.equal(v?.action, 'revise');
  assert.match(v.reason, /素材从哪来/);
});

test('a video handed over with MEDIA: counts as a video even when no tool call names the .mp4', (t) => {
  // 11-04 routes-i R-ad: `python3 render_osmanthus_ad.py` ran in the background and wrote output/*.mp4 itself;
  // nothing in the tool record ended in .mp4, so the source check never ran.
  const {root, guard, ctx} = setup(t, '剪一个 15 秒的竖屏抖音广告，卖我们店新出的桂花拿铁，出 MP4 给我');
  guard.afterTool({toolName: 'write', toolCallId: 'script', params: {path: path.join(root, 'render_osmanthus_ad.py'), content: 'print(1)'}, result: 'ok'}, ctx);
  guard.afterTool({toolName: 'exec', toolCallId: 'run', params: {command: 'python3 render_osmanthus_ad.py'}, result: 'Command still running (session neat-slug, pid 4242)'}, ctx);
  guard.afterTool({toolName: 'process', toolCallId: 'poll', params: {action: 'poll', sessionId: 'neat-slug'}, result: 'Process exited with code 0'}, ctx);
  guard.afterTool({toolName: 'exec', toolCallId: 'look', params: {command: 'look-video output/ad.mp4 12'}, result: 'ok'}, ctx);
  guard.afterTool({toolName: 'read', toolCallId: 'see', params: {path: path.join(root, 'output/ad.preview.png')}, result: 'image'}, ctx);
  const reply = '**15 秒桂花拿铁竖屏广告 MP4 已剪辑并渲染完成**，内置 Lo-fi BGM 和普通话旁白。\n\nMEDIA:' + path.join(root, 'output/ad.mp4');
  const decision = guard.finalize({lastAssistantMessage: reply}, ctx, {verifyExternal: false});
  assert.equal(decision?.action, 'revise');
  assert.match(decision.reason, /素材从哪来/);

  // A picture delivered the same way is not a video: no source question.
  const pic = setup(t, '帮我做个小红书封面，主题是「租房避坑 7 条」，直接出图给我');
  pic.guard.afterTool({toolName: 'exec', toolCallId: 'run', params: {command: 'python3 cover.py'}, result: 'ok'}, pic.ctx);
  pic.guard.afterTool({toolName: 'read', toolCallId: 'see', params: {path: path.join(pic.root, 'cover.png')}, result: 'image'}, pic.ctx);
  const cover = pic.guard.finalize({lastAssistantMessage: '封面做好了。\n\nMEDIA:' + path.join(pic.root, 'cover.png')}, pic.ctx, {verifyExternal: false});
  assert.doesNotMatch(String(cover?.reason || ''), /素材从哪来/);
});

test('the sources note rides along when another reminder fires first', (t) => {
  // 11-04 routes-i R-ad-2: the side-panel browser is not connected, so the last tool call failed;
  // that reminder used up the single reminder of the turn and the sources were never asked for.
  const {root, guard, ctx} = setup(t, '剪一个 15 秒的竖屏抖音广告，卖我们店新出的桂花拿铁，出 MP4 给我');
  const video = path.join(root, 'ad.mp4');
  produce(guard, ctx, 'render', `ffmpeg -y -i raw_video.mp4 -i audio_track.wav -shortest "${video}"`, video);
  guard.afterTool({toolName: 'exec', toolCallId: 'look', params: {command: `look-video "${video}" 9`}, result: 'ok'}, ctx);
  guard.afterTool({toolName: 'read', toolCallId: 'see', params: {path: path.join(root, 'ad.preview.png')}, result: 'image'}, ctx);
  guard.beforeTool({toolName: 'app_browser', toolCallId: 'side', params: {action: 'open', url: 'file:///tmp/preview.html'}}, ctx);
  guard.afterTool({toolName: 'app_browser', toolCallId: 'side', params: {action: 'open', url: 'file:///tmp/preview.html'}, error: '当前 App 的侧栏浏览器尚未连接', result: {ok: false}}, ctx);
  const reply = '这支 15 秒的桂花拿铁抖音竖屏广告已经剪辑完成，自带配乐与中文旁白。\n\nMEDIA:' + video;
  const decision = guard.finalize({lastAssistantMessage: reply}, ctx, {verifyExternal: false});
  assert.equal(decision?.action, 'revise');
  assert.match(decision.reason, /最后一次工具调用失败/);
  assert.match(decision.reason, /另外，交付的视频没说清素材从哪来/);
  assert.match(decision.retry.instruction, /素材从哪来/);
  // Said once is enough: the same check on the same reply does not stack the note twice.
  const again = guard.finalize({lastAssistantMessage: reply}, ctx, {verifyExternal: false});
  assert.equal((again.reason.match(/素材从哪来/g) || []).length, 1);
});


test('next-step buttons after a delivered file do not turn the reply into an in-chat deliverable', (t) => {
  // 11-04 routes-l R-ad: the MP4 was handed over with MEDIA:, followed by a ```ui``` block of three
  // next-step buttons. The guard took the buttons for an in-chat mini app and skipped both delivery checks.
  const buttons = '```ui\n{"text":"广告视频已生成，接下来需要：","buttons":["满意，直接导出投流（推荐）","微调优惠价格或文案","换一套轻快活泼的BGM"]}\n```';
  const {root, guard, ctx} = setup(t, '剪一个 15 秒的竖屏抖音广告，卖我们店新出的桂花拿铁，出 MP4 给我');
  guard.afterTool({toolName: 'exec', toolCallId: 'run', params: {command: 'python3 render_full_mp4.py'}, result: 'Process exited with code 0'}, ctx);
  guard.afterTool({toolName: 'read', toolCallId: 'see', params: {path: path.join(root, 'ad.preview.png')}, result: 'image'}, ctx);
  const reply = '**这杯「桂花拿铁」15 秒竖屏抖音广告 MP4 已经剪好交付**，自带卡点配音、BGM 与卡拉OK高亮字幕。\n\n' + buttons
    + '\n\nMEDIA:' + path.join(root, '桂花拿铁_秋日限定广告_15s.mp4');
  const decision = guard.finalize({lastAssistantMessage: reply}, ctx, {verifyExternal: false});
  assert.equal(decision?.action, 'revise');
  assert.match(decision.reason, /素材从哪来/);

  // routes-i R-ad-2: the attachment failed, so the runtime replaced MEDIA: with "Media failed";
  // the reply still names the finished file's path, which is a delivery all the same.
  const failed = setup(t, '剪一个 15 秒的竖屏抖音广告，卖我们店新出的桂花拿铁，出 MP4 给我');
  failed.guard.afterTool({toolName: 'exec', toolCallId: 'run', params: {command: 'python3 render.py'}, result: 'ok'}, failed.ctx);
  failed.guard.afterTool({toolName: 'read', toolCallId: 'see', params: {path: path.join(failed.root, 'ad.preview.jpg')}, result: 'image'}, failed.ctx);
  const named = '这支 15 秒广告已经剪好。\n视频文件路径：`' + path.join(failed.root, 'osmanthus_latte_ad_15s.mp4') + '`\n⚠️ Media failed.\n\n' + buttons;
  const second = failed.guard.finalize({lastAssistantMessage: named}, failed.ctx, {verifyExternal: false});
  assert.equal(second?.action, 'revise');
  assert.match(second.reason, /素材从哪来/);

  // Choice buttons that close a turn which already produced a file are not the deliverable either.
  const made = setup(t, '帮我做一个 4 分钟的爱情故事视频');
  const video = path.join(made.root, 'love.mp4');
  produce(made.guard, made.ctx, 'render', `ffmpeg -y -i frames/%04d.png "${video}"`, video);
  const unseen = made.guard.finalize({lastAssistantMessage: '视频做好了，4 分钟。\n\n' + buttons}, made.ctx, {verifyExternal: false});
  assert.equal(unseen?.action, 'revise');
  assert.match(unseen.reason, /亲眼|看/);
});

test('asking with buttons before any work, or answering with a chart, still passes as an in-chat reply', (t) => {
  const ask = setup(t, '帮我做一张开业海报');
  const question = '先定个方向，碧琪按你选的直接做。\n\n```ui\n{"text":"海报走哪种感觉？","buttons":["安静高级（推荐）","热闹年轻"]}\n```';
  assert.notEqual(ask.guard.finalize({lastAssistantMessage: question}, ask.ctx, {verifyExternal: false})?.action, 'revise');

  const chart = setup(t, '把这三个月的吃饭花销画成图：8月 2400，9月 2050，10月 1760');
  const answer = '吃饭花销连降两个月。\n\n```chart\n{"type":"bar","title":"吃饭花销连降两个月","labels":["8月","9月","10月"],"series":[{"name":"吃饭","data":[2400,2050,1760]}],"unit":"元"}\n```';
  assert.notEqual(chart.guard.finalize({lastAssistantMessage: answer}, chart.ctx, {verifyExternal: false})?.action, 'revise');
});
