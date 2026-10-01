const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
function setup(){
  const images=[],timers=new Map();let serial=0;
  class Image {constructor(){images.push(this);this.naturalWidth=50;}decode(){return Promise.resolve();}}
  const window={Image,setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(read('ui/injections/laolao-motion.js'),{window});
  return {window,motion:window.PinkieMotion,images,timers};
}
function nodes(){
  const writes=[];const style=new Proxy({}, {set(o,k,v){writes.push([k,v]);o[k]=v;return true;}});
  return {fill:{style},label:{textContent:''},bar:{setAttribute:(k,v)=>writes.push([k,v])},writes};
}
test('progress is monotonic, clamped, transform-only, and avoids duplicate DOM writes',()=>{
  const {motion}=setup(),{fill,label,bar,writes}=nodes();
  for(const n of [8,8.2,9,70,40,96,68,100,110])motion.progress(fill,label,bar,n);
  assert.deepEqual(writes.filter(x=>x[0]==='transform').map(x=>x[1]),['scaleX(0.08)','scaleX(0.09)','scaleX(0.7)','scaleX(0.96)','scaleX(1)']);
  assert.equal(label.textContent,'100%');assert.equal(fill.style.width,undefined);
});
test('readiness must remain true continuously, not just for a single render',()=>{
  let ready=false;const check=setup().motion.stable(()=>ready,300);
  assert.equal(check(0),false);ready=true;assert.equal(check(100),false);assert.equal(check(399),false);
  ready=false;assert.equal(check(400),false);ready=true;assert.equal(check(500),false);assert.equal(check(799),false);assert.equal(check(800),true);
});
test('completion glides to 100 instead of jumping, including reduced motion',async()=>{
  const {window,motion}=setup(),{fill,label,bar}=nodes();let frame;
  window.requestAnimationFrame=fn=>{frame=fn;};motion.progress(fill,label,bar,80);
  const done=motion.finishProgress(fill,label,bar);frame(0);assert.equal(label.textContent,'80%');frame(150);assert.equal(label.textContent,'95%');frame(300);await done;assert.equal(label.textContent,'100%');
  window.matchMedia=()=>({matches:true});const next=nodes();await motion.finishProgress(next.fill,next.label,next.bar);assert.equal(next.label.textContent,'100%');
});
test('preload is deduplicated and waits for decoding, not just download',async()=>{
  const {motion,images,timers}=setup();let decoded;const first=motion.preload('scene.png');
  assert.equal(motion.preload('scene.png'),first);assert.equal(images.length,1);
  images[0].decode=()=>new Promise(resolve=>decoded=resolve);images[0].onload();
  let settled=false;first.then(()=>settled=true);await Promise.resolve();assert.equal(settled,false);
  decoded();assert.equal(await first,true);assert.equal(timers.size,0);
});
test('failed and timed-out decorative assets settle and can be retried',async()=>{
  const {motion,images,timers}=setup();const failed=motion.preload('missing.png');images[0].onerror();assert.equal(await failed,false);
  const retry=motion.preload('missing.png');assert.equal(images.length,2);images[1].onload();assert.equal(await retry,true);
  const slow=motion.preload('slow.png');[...timers.values()][0]();assert.equal(await slow,false);
});
test('chat readiness includes image completion, mode, input, and skeleton removal',()=>{
  const {window,motion}=setup();let complete=false,skeleton=false,mode='project',input=true;
  window.document={documentElement:{getAttribute:()=>mode},querySelector:s=>s.startsWith('[data-')?{complete}:s==='.agent-chat__input'?input:s==='.chat-loading-skeleton'?skeleton:null};
  assert.equal(motion.chatReady('project'),false);complete=true;assert.equal(motion.chatReady('project'),true);
  skeleton=true;assert.equal(motion.chatReady('project'),false);skeleton=false;mode='chat';assert.equal(motion.chatReady('project'),false);
  mode='project';input=false;assert.equal(motion.chatReady('project'),false);
});
test('a thread with no assistant messages can use the loaded mode portrait',()=>{
  const {window,motion}=setup();
  window.document={documentElement:{getAttribute:()=> 'chat'},querySelector:s=>s.startsWith('.laolao-mode-switcher')?{complete:true}:s==='.agent-chat__input'?{}:null};
  assert.equal(motion.chatReady('chat'),true);
});
test('OpenClaw 7.1 composer releases the entrance instead of leaving it at 94 percent',()=>{
  const {window,motion}=setup();
  window.document={
    documentElement:{getAttribute:()=> 'project'},
    querySelector:s=>s.startsWith('[data-laolao-mode-avatar')?{complete:true}:
      s==='.agent-chat__composer-combobox textarea'?{}:null,
  };
  assert.equal(motion.chatReady('project'),true);
});
test('handoff first-frame bootstrap carries progress without a width reset',()=>{
  const {window,motion}=setup(),{fill,label,bar}=nodes();const message={};
  const classes=[],styles=[];
  const splash={
    dataset:{},
    classList:{add(...names){classes.push(...names);}},
    style:{setProperty:(name,value)=>styles.push([name,value])},
    querySelector:s=>s.startsWith('[role')?bar:null,
  };
  const elements={'laolao-splash':splash,'laolao-splash-fill':fill,'laolao-splash-message':message,'laolao-splash-percentage':label};
  vm.runInNewContext(read('ui/injections/laolao-handoff-bootstrap.js'),{window,document:{getElementById:id=>elements[id]},sessionStorage:{getItem:()=>JSON.stringify({mode:'thinking',progress:93})}});
  assert.equal(splash.dataset.handoffBootstrapped,'1');
  assert.ok(classes.includes('is-mode-progress'));assert.ok(classes.includes('is-mode-progress--thinking'));
  assert.deepEqual(styles,[['--laolao-mode-progress-image','url("/laolao-mode-transition-thinking.png?v=transition2")']]);
  assert.equal(fill.style.transition,'none');assert.equal(message.textContent,'灵感房间正在亮灯…');
  assert.equal(fill.style.transform,'scaleX(0.93)');assert.equal(label.textContent,'93%');
  motion.progress(fill,label,bar,68);assert.equal(label.textContent,'93%');
});
test('cold startup and handoff retain their safety gates while splash FX stays optional',()=>{
  const splash=read('ui/injections/laolao-splash.js');
  const bootstrap=read('ui/injections/laolao-handoff-bootstrap.js');
  // Cold launch keeps its 2.6s beat; a full-refresh handoff still starts at
  // carried progress and has the shorter existing gate.
  assert.match(splash,/const initial = switching \? Math\.max\(68, Math\.min\(96, Number\(handoff\?\.progress\) \|\| 68\)\) : 8/);
  assert.match(splash,/const minimum = motion\.reduced\(\) \? 400 : switching \? 700 : 2600/);
  assert.match(bootstrap,/const carriedProgress = Math\.max\(68, Math\.min\(96, Number\(handoff\.progress\) \|\| 68\)\)/);
  assert.match(bootstrap,/fill\.style\.transition = "none"[\s\S]*PinkieMotion\.progress\(fill, percentage, progressbar, carriedProgress\)/);

  // The canvas is deliberately an optional, idle-time enhancement. Reduced
  // motion, a missing controller/WebGL, or an asset failure must leave the
  // old static controller running instead of blocking the page.
  assert.match(splash,/if \(switching \|\| motion\.reduced\(\)\) return/);
  assert.match(splash,/requestIdleCallback\(startFx/);
  assert.match(splash,/PinkieSplashFx\?\.play\?\./);
  assert.match(splash,/if \(!candidate\) return/);
  assert.match(splash,/candidate\.ready[\s\S]*?\.catch\(\(\) => \{[\s\S]*?splashFx = null/);
  assert.match(splash,/splashFx\?\.abort\(\)/);

  // Keep every legacy escape hatch and event: 6.5s shell escape, real-login
  // escape, 30s recovery controls, docked direct removal, and the cleared
  // event after either the FX or static leave path.
  assert.match(splash,/elapsed >= 6500[\s\S]{0,180}leave\(false\)/);
  assert.match(splash,/loginReady\(now\) && elapsed >= 5000/);
  assert.match(splash,/\}, 30000\);/);
  assert.match(splash,/if \(docked\) \{[\s\S]{0,700}splash\.remove\(\)[\s\S]{0,260}laolao:splash-cleared/);
  // FX 离场：等冲破开屏播完再移除；没在冲破时入场的兜底补一次 motion.enter()。
  assert.match(splash,/await splashFx\.finish\(\);[\s\S]{0,80}if \(!fxEntered\) motion\.enter\(\);[\s\S]{0,40}splash\.remove\(\)[\s\S]{0,160}laolao:splash-cleared/);
  assert.match(splash,/splash\.classList\.add\('is-leaving'\)[\s\S]{0,120}splash\.remove\(\)[\s\S]{0,160}laolao:splash-cleared/);
});
test('startup cannot force success on timeout; animation survives while error recovery stays available',()=>{
  const splash=read('ui/injections/laolao-splash.js'),mode=read('ui/injections/laolao-mode-switcher.js');
  assert.doesNotMatch(splash,/setTimeout\(completeHandoff/);assert.match(splash,/重新连接/);assert.match(splash,/leave\(false\)/);
  assert.doesNotMatch(splash+mode,/\.style\.width\s*=/);assert.match(mode,/motion\.stable/);
  for(const css of ['ui/injections/laolao-theme.css','ui/injections/laolao-splash.css']){
    const source=read(css);assert.match(source,/transform: scaleX\(\.08\)/);
    const progress=css.endsWith('laolao-splash.css')
      ? source.match(/\.laolao-splash__progress-fill \{([\s\S]*?)\n\}/)?.[1]
      : source.match(/\.laolao-mode-transition__fill \{([\s\S]*?)\n\}/)?.[1];
    assert.ok(progress, `missing progress fill rule in ${css}`);
    assert.doesNotMatch(progress,/transition: width/);
  }
});
test('mode switching prewarms every local scene and has no old multi-second artificial gate',()=>{
  const mode=read('ui/injections/laolao-mode-switcher.js');
  assert.match(mode,/Promise\.all\(modes\.map\(mode => motion\.preload\(mode\.transition\)\)\)/);
  assert.match(mode,/requestIdleCallback/);
  assert.match(mode,/pointerenter/);
  assert.match(mode,/runDuration = motion\.reduced\(\) \? 100 : 420/);
  assert.match(mode,/elapsed >= 120/);
  assert.match(mode,/finishProgress\(ui\.fill, ui\.percentage, ui\.progress, 160\)/);
  assert.doesNotMatch(mode,/runDuration = motion\.reduced\(\) \? 400 : 2400/);
  assert.doesNotMatch(mode,/setTimeout\(preloadTransitions, 3600\)/);
});
test('shared motion module is shipped for both app and party',()=>{
  assert.match(read('installer/macos/apply-theme.sh'),/laolao-motion\.js/);
  assert.match(read('services/party/server.py'),/'\/party-motion\.js': ROOT \/ 'ui\/injections\/laolao-motion\.js'/);
  const html=read('ui/party/index.html');assert.ok(html.indexOf('/party-motion.js')<html.indexOf('src="/party.js'));
});
