const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('manual context control uses native compaction without posting a chat command',()=>{
  const source=read('ui/injections/laolao-context-compact.js');
  assert.match(source,/rpc\("sessions\.compact", \{key, agentId\}, 600_000\)/);
  assert.match(source,/手动整理上下文/);
  assert.match(source,/最近对话和工作检查点继续保留/);
  assert.match(source,/chat-send-btn--stop/);
  assert.doesNotMatch(source,/chat\.send|\/compact/);
});

test('manual context control ships in both UI installers',()=>{
  for(const file of ['installer/macos/apply-theme.sh','installer/windows/apply-theme.ps1']){
    const source=read(file);
    assert.match(source,/laolao-context-compact\.js/);
    assert.match(source,/contextcompact4/);
  }
});

test('missing native context ring is repaired from real session usage, never a guessed percentage',()=>{
  const source=read('ui/injections/laolao-context-compact.js');
  assert.match(source,/meta\.querySelector\("\.context-usage"\)/);
  assert.match(source,/rpc\("sessions\.list", \{agentId, limit: 1000\}/);
  const window={addEventListener(){}};
  const document={
    addEventListener(){}, getElementById(){return null;},
    querySelector(){return null;}, querySelectorAll(){return [];},
    createElement(){return {id:'',style:{},textContent:''};},
    head:{append(){}},
  };
  vm.runInNewContext(source,{window,document,location:{search:''},URLSearchParams,setInterval(){}});
  const calculate=window.__laolaoContextCompact.contextCapacity;
  assert.equal(calculate({totalTokens:198045,contextTokens:1000000},{}).percent,20);
  assert.equal(calculate({totalTokens:0},{contextTokens:1000000}).percent,0);
  assert.equal(calculate({contextTokens:1000000},{contextTokens:1000000}),null);
  assert.equal(calculate({totalTokens:null,contextTokens:1000000},{}),null);
});

test('stream cursor does not create its own animation-frame mutation loop',()=>{
  const script=read('ui/injections/laolao-stream-fx.js');
  const css=read('ui/injections/laolao-theme.css');
  assert.match(script,/bubble\.lastChild !== existing/);
  assert.doesNotMatch(css,/@keyframes pinkieStreamIn/);
  assert.match(css,/data-pinkie-streaming="true"[\s\S]*animation: none !important/);
});
