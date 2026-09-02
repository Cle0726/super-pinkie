const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

test('extreme-think UI has three bounded tiers and arms a clean one-shot runtime instruction',()=>{
  const src=read('ui/injections/laolao-deep-think.js');
  for(const tier of ['base','boost','full'])assert.match(src,new RegExp(`id: "${tier}"`));
  assert.match(src,/pinkie\.deepThink\.arm/);
  assert.match(src,/armed \? question/);
  assert.match(src,/仅作用于本次消息/);
  assert.match(src,/继承当前模式与项目/);
  assert.doesNotMatch(src,/<<<问题开始>>>/);
});

test('tier menu uses compact self-drawn pink glass controls and avoids a root mutation observer',()=>{
  const src=read('ui/injections/laolao-deep-think.js');
  assert.match(src,/viewBox='0 0 24 24'/);
  assert.match(src,/grid-template-columns:repeat\(3/);
  assert.match(src,/width:30px; height: 30px/);
  assert.match(src,/backdrop-filter: blur\(26px\)/);
  assert.doesNotMatch(src,/✦|🧠|⚡|🔥/);
  assert.match(src,/window\.setInterval\(scheduleRender, 700\)/);
  assert.doesNotMatch(src,/new MutationObserver/);
});

test('extreme-think send fallback never clicks the voice or native dictation controls',()=>{
  const src=read('ui/injections/laolao-deep-think.js');
  assert.match(src,/chat-send-btn--stop/);
  assert.match(src,/chat-send-btn--voice/);
  assert.match(src,/chat-send-btn--laolao-dictation/);
  assert.match(src,/chat-send-btn--queue/);
});
