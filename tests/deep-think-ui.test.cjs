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
  assert.match(src,/chat\.abort/);
  assert.match(src,/preserveSideRuns: false/);
  assert.match(src,/status\.active && !selectedTier/);
  assert.match(src,/当前档位已停止，恢复普通发送/);
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
  assert.match(src,/pinkie:tier-complete/);
  assert.match(src,/上一轮还在执行，完成后会自动显示终稿/);
  assert.match(src,/status\.roles/);
  assert.match(src,/completed.*required/s);
  assert.match(src,/laolao-status-flow/);
  assert.match(src,/fill\.style\.transform = `scaleX/);
  assert.doesNotMatch(src,/details\.replaceChildren/);
  assert.match(src,/(?:window\.setInterval|domWatch\?\.poll)\(\(\) => \{ if \(!document\.hidden\) void refreshStatus\(\); \}, 900\)/);
});

test('tier completion refreshes only the bounded live timeline window while reload stays a guarded offline-only fallback',()=>{
  const src=read('ui/injections/laolao-resume.js');
  assert.match(src,/pinkie:tier-complete/);
  assert.match(src,/refreshVisibleChat/);
  assert.match(src,/requestRecovery\("chat\.history"/);
  assert.match(src,/recoverCurrentChat\("manual-refresh", \{force: true, manual: true\}\)/);
  assert.match(src,/直接读取有界时间线窗口/);
  assert.doesNotMatch(src,/state\.refreshCurrentChat/);
  assert.match(src,/scheduleRecovery\("tier-complete"/);
  assert.doesNotMatch(src,/button\.chat-settings-action/);
  assert.match(src,/body\?\.ready === true && !gatewayConnected\(\) && !nativeGatewayConnected\(\)/);
  assert.match(src,/now - previous < 30_000/);
});

test('tier menu keeps its glass design and observes mode changes without a subtree mutation observer',()=>{
  const src=read('ui/injections/laolao-deep-think.js');
  assert.match(src,/viewBox='0 0 24 24'/);
  assert.match(src,/grid-template-columns:repeat\(2/);
  assert.match(src,/写好计划，一直做到完/);
  // 卡片和 docs/DEEP-THINK-TIERS.md 一致：按活儿种类走、要真凭据、多做几版、写计划做到完。
  for(const text of ['按活儿种类走对的做法','说做完，就要有真凭据','多做几版，挑出最好的']) assert.ok(src.includes(text),text);
  assert.match(src,/"活儿种类"/);
  assert.match(src,/width:30px; height: 30px/);
  assert.match(src,/backdrop-filter:blur\(28px\)/);
  assert.match(src,/item\.dataset\.tier = tier\.id/);
  assert.match(src,/btn\.dataset\.tierSymbol/);
  assert.match(src,/asset\("\/laolao-deep-think-base\.png"\)/);
  assert.match(src,/asset\("\/laolao-deep-think-base\.webm"\)/);
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
  assert.match(src,/attributeFilter: \["data-laolao-mode"\]/);
  assert.doesNotMatch(src,/subtree:\s*true/);
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

test('night tier menu text follows data-pinkie-night, not only data-theme-mode=dark',()=>{
  const src=read('ui/injections/laolao-deep-think.js');
  const night=':is(html[data-theme-mode="dark"],html[data-pinkie-night])';
  assert.ok(src.includes(`${night} :is(.laolao-deep-think-menu__head,.laolao-deep-think-menu__summary,.laolao-deep-think-menu__hint){color:`),'夜间 head / summary / hint 有夜间色');
  assert.ok(src.includes(`${night} .laolao-deep-think-menu__footer{color:`),'夜间 footer 有夜间色');
  assert.doesNotMatch(src,/html\[data-theme-mode="dark"\] \.laolao-deep-think-menu\{/,'不再留只认 dark 的菜单整块规则');
});

test('day tier menu text keeps >= 4.5:1 alphas, not the old faded ones',()=>{
  const src=read('ui/injections/laolao-deep-think.js');
  const day={head:'.78',summary:'.82',hint:'.78',footer:'.78'};
  for(const [name,a] of Object.entries(day)){
    const rule=src.match(new RegExp(`\\n\\.laolao-deep-think-menu__${name} ?\\{[^}]*\\}|\\}\\.laolao-deep-think-menu__${name}\\{[^}]*\\}`));
    assert.ok(rule,`日间 ${name} 规则存在`);
    assert.ok(rule[0].includes(`color:rgba(87,54,74,${a})`),`日间 ${name} 用 alpha ${a}（实际 ${rule[0]}）`);
  }
  assert.doesNotMatch(src,/rgba\(87,54,74,\.(72|53|62|43)\)/,'不留旧日间淡色');
});
