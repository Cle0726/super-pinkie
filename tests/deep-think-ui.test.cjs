const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

test('extreme-think selection persists and arms every send without rewriting the draft',()=>{
  const src=read('ui/injections/laolao-deep-think.js');
  for(const tier of ['base','boost','full','marathon'])assert.match(src,new RegExp(`id: "${tier}"`));
  assert.match(src,/pinkie\.deepThink\.arm/);
  assert.match(src,/pinkie\.deepThink\.disarm/);
  assert.match(src,/pinkie\.deepThink\.status/);
  assert.match(src,/laolao:deep-think-tier/);
  assert.match(src,/localStorage\.setItem/);
  assert.match(src,/afterArm/);
  assert.match(src,/再次点选当前档位即可取消/);
  assert.match(src,/继承当前模式与项目/);
  assert.doesNotMatch(src,/deep-think:base|deep-think:boost|deep-think:full|<<<问题开始>>>/);
  assert.doesNotMatch(src,/先在输入框写问题/);
});

test('main chat shows aggregate worker progress without exposing child chats',()=>{
  const src=read('ui/injections/laolao-deep-think.js');
  assert.match(src,/laolao-deep-think-status/);
  assert.match(src,/协作处理中/);
  assert.match(src,/全部完成，正在汇总/);
  assert.match(src,/status\.roles/);
  assert.match(src,/completed.*required/s);
  assert.match(src,/laolao-status-flow/);
  assert.match(src,/fill\.style\.transform = `scaleX/);
  assert.doesNotMatch(src,/details\.replaceChildren/);
  assert.match(src,/window\.setInterval\(\(\) => \{ if \(!document\.hidden\) void refreshStatus\(\); \}, 900\)/);
});

test('tier menu uses compact self-drawn pink glass controls and avoids a root mutation observer',()=>{
  const src=read('ui/injections/laolao-deep-think.js');
  assert.match(src,/viewBox='0 0 24 24'/);
  assert.match(src,/grid-template-columns:repeat\(2/);
  assert.match(src,/无人值守持续执行/);
  assert.match(src,/width:30px; height: 30px/);
  assert.match(src,/backdrop-filter:blur\(28px\)/);
  assert.match(src,/item\.dataset\.tier = tier\.id/);
  assert.match(src,/btn\.dataset\.tierSymbol/);
  assert.match(src,/laolao-deep-think-base\.png\?v=tierart3/);
  assert.match(src,/laolao-deep-think-base\.webm\?v=tiermotion2/);
  assert.match(src,/laolao-deep-think-menu__poster/);
  assert.match(src,/<video class="laolao-deep-think-menu__art"/);
  assert.match(src,/laolao-deep-think-btn__art/);
  for(const tier of ['base','boost','full','marathon'])assert.match(src,new RegExp(`data-tier=\\"${tier}\\"`));
  assert.match(src,/@keyframes laolao-tier-orbit/);
  assert.match(src,/@keyframes laolao-tier-breathe/);
  assert.match(src,/@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(src,/rgba\(30,27,46/);
  assert.doesNotMatch(src,/✦|🧠|⚡|🔥/);
  assert.match(src,/window\.setInterval\(scheduleRender, 700\)/);
  assert.doesNotMatch(src,/new MutationObserver/);
});

test('all four generated tier videos and their reproducible sources are shipped',()=>{
  for(const [index,tier] of ['base','boost','full','marathon'].entries()){
    assert.ok(fs.statSync(path.join(__dirname,'..',`ui/assets/laolao-deep-think-${tier}.webm`)).size>0);
    assert.ok(fs.statSync(path.join(__dirname,'..',`ui/assets/deep-think/source-video/tier-${index+1}-${tier}.mp4`)).size>0);
  }
});

test('extreme-think send fallback never clicks the voice or native dictation controls',()=>{
  const src=read('ui/injections/laolao-deep-think.js');
  assert.match(src,/chat-send-btn--stop/);
  assert.match(src,/chat-send-btn--voice/);
  assert.match(src,/chat-send-btn--laolao-dictation/);
  assert.match(src,/chat-send-btn--queue/);
});
