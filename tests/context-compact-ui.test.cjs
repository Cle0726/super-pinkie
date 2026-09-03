const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
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
    assert.match(source,/contextcompact1/);
  }
});

test('stream cursor does not create its own animation-frame mutation loop',()=>{
  const script=read('ui/injections/laolao-stream-fx.js');
  const css=read('ui/injections/laolao-theme.css');
  assert.match(script,/bubble\.lastChild !== existing/);
  assert.doesNotMatch(css,/@keyframes pinkieStreamIn/);
  assert.match(css,/data-pinkie-streaming="true"[\s\S]*animation: none !important/);
});
