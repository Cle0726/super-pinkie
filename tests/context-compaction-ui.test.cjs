const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../ui/injections/laolao-context-compact.js'),'utf8');

test('context threshold note reads the budget returned by the gateway',()=>{
  const window={addEventListener(){}};
  const document={
    addEventListener(){},getElementById(){return null;},querySelector(){return null;},
    querySelectorAll(){return [];},createElement(){return {style:{},textContent:''};},
    head:{append(){}},
  };
  vm.runInNewContext(source,{window,document,location:{search:''},URLSearchParams,setInterval(){}});
  const capacity=window.__laolaoContextCompact.contextCapacity({
    totalTokens:198045,
    contextTokens:272000,
    pinkieCompactionBudget:{window:272000,threshold:231200,triggerRatio:.85},
  },{});
  assert.equal(capacity.compactionBudget.window,272000);
  assert.equal(capacity.compactionBudget.threshold,231200);
  assert.equal(capacity.compactionBudget.triggerRatio,.85);
  assert.doesNotMatch(source,/850000|0\.85/);
});

test('compaction progress survives refresh and gateway events cover automatic and manual paths',()=>{
  assert.match(source,/COMPACTION_STATE_PREFIX/);
  assert.match(source,/localStorage\.setItem/);
  assert.match(source,/localStorage\.getItem/);
  assert.match(source,/name === "session\.operation"/);
  assert.match(source,/payload\.stream !== "compaction"/);
  assert.match(source,/已用时/);
  assert.match(source,/整理前 \$\{before\} → \$\{after\} 令牌/);
});

test('compaction divider becomes one Chinese timeline row and drops the checkpoint action',()=>{
  assert.match(source,/前面的对话已整理，原始记录仍保留/);
  assert.match(source,/\.chat-divider__details\{display:none!important\}/);
  assert.match(source,/\.chat-divider\{margin:6px 8px!important\}/);
});
