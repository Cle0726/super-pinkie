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
test('handoff first-frame bootstrap carries progress without a width reset',()=>{
  const {window,motion}=setup(),{fill,label,bar}=nodes();const message={};
  const splash={dataset:{},classList:{add(){}},style:{setProperty(){}},querySelector:s=>s.startsWith('[role')?bar:null};
  const elements={'laolao-splash':splash,'laolao-splash-fill':fill,'laolao-splash-message':message,'laolao-splash-percentage':label};
  vm.runInNewContext(read('ui/injections/laolao-handoff-bootstrap.js'),{window,document:{getElementById:id=>elements[id]},sessionStorage:{getItem:()=>JSON.stringify({mode:'thinking',progress:93})}});
  assert.equal(fill.style.transform,'scaleX(0.93)');assert.equal(label.textContent,'93%');
  motion.progress(fill,label,bar,68);assert.equal(label.textContent,'93%');
});
test('startup cannot force success on timeout; animation survives while error recovery stays available',()=>{
  const splash=read('ui/injections/laolao-splash.js'),mode=read('ui/injections/laolao-mode-switcher.js');
  assert.doesNotMatch(splash,/setTimeout\(completeHandoff/);assert.match(splash,/重新连接/);assert.match(splash,/leave\(false\)/);
  assert.doesNotMatch(splash+mode,/\.style\.width\s*=/);assert.match(mode,/motion\.stable/);
  for(const css of ['ui/injections/laolao-theme.css','ui/injections/laolao-splash.css']){
    const source=read(css);assert.match(source,/transform: scaleX\(\.08\)/);assert.doesNotMatch(source,/transition: width/);
  }
});
test('shared motion module is shipped for both app and party',()=>{
  assert.match(read('installer/macos/apply-theme.sh'),/laolao-motion\.js/);
  assert.match(read('services/party/server.py'),/'\/party-motion\.js': ROOT \/ 'ui\/injections\/laolao-motion\.js'/);
  const html=read('ui/party/index.html');assert.ok(html.indexOf('/party-motion.js')<html.indexOf('src="/party.js'));
});
