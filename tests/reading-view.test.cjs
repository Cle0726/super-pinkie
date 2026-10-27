const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const script=fs.readFileSync(require('node:path').join(__dirname,'../ui/injections/laolao-reading-view.js'),'utf8');
function harness(){let panes=[],docked=false;const attrs=new Map(),root={getAttribute:key=>key==='data-laolao-workspace-dock'&&docked?'1':attrs.get(key),setAttribute:(k,v)=>attrs.set(k,v)};const document={documentElement:root,querySelectorAll:()=>panes};const window={};vm.runInNewContext(script,{window,document,MutationObserver:class{observe(){}},requestAnimationFrame:()=>1,Array});function pane(key,text){const a=new Set();return{state:{sessionKey:key,chatMessage:text,handleChatDraftChange(value){this.chatMessage=value}},hasAttribute:key=>a.has(key),toggleAttribute:(key,on)=>on?a.add(key):a.delete(key),requestUpdate(){}}}return{api:window.__pinkieReadingViews,pane,set(value){panes=value;window.__pinkieReadingViews.refresh()},dock(value){docked=value;window.__pinkieReadingViews.refresh()}}}
test('only additional panes become reading views; focusing or reordering does not change the primary',()=>{const h=harness(),main=h.pane('a','答案'),other=h.pane('b','');h.set([main]);assert.equal(h.api.isReading(main),false);h.set([main,other]);assert.equal(main.hasAttribute('data-pinkie-reading-view'),false);assert.equal(other.hasAttribute('data-pinkie-reading-view'),true);h.set([other,main]);assert.equal(h.api.isReading(main),false);assert.equal(h.api.isReading(other),true)});
test('replacing a native pane or closing the primary transfers its current same-session draft, including a cleared draft',()=>{const h=harness(),main=h.pane('a','未写完'),copy=h.pane('a','旧草稿');h.set([main,copy]);main.state.chatMessage='';h.set([copy]);assert.equal(copy.state.chatMessage,'');assert.equal(copy.hasAttribute('data-pinkie-reading-view'),false);const replacement=h.pane('a','');copy.state.chatMessage='新的两行\n第二行';h.set([replacement]);assert.equal(replacement.state.chatMessage,copy.state.chatMessage)});
test('promoting a different session preserves its own draft; a mode companion keeps its full primary UI',()=>{const h=harness(),main=h.pane('a','甲草稿'),other=h.pane('b','乙草稿');h.set([main,other]);h.set([other]);assert.equal(other.state.chatMessage,'乙草稿');h.dock(true);assert.equal(h.api.isReading(other),false);assert.equal(other.hasAttribute('data-pinkie-reading-view'),false)});
test('dual-open modes each own a primary pane; only their own split children become reading views',()=>{
  const left=harness(),right=harness(),a=left.pane('unrestricted','左侧答案'),b=right.pane('learning','右侧答案');
  left.set([a]);right.dock(true);right.set([b]);
  assert.equal(left.api.isReading(a),false);assert.equal(right.api.isReading(b),false);
  const copyLeft=left.pane('unrestricted',''),copyRight=right.pane('learning','');
  left.set([a,copyLeft]);right.set([b,copyRight]);
  assert.equal(left.api.isReading(a),false);assert.equal(right.api.isReading(b),false);
  assert.equal(left.api.isReading(copyLeft),true);assert.equal(right.api.isReading(copyRight),true);
  right.dock(false);assert.equal(right.api.isReading(b),false);assert.equal(right.api.isReading(copyRight),true);
  right.set([b]);assert.equal(right.api.isReading(b),false);assert.equal(b.state.chatMessage,'右侧答案');
});
test('reading styles have no mode-wide dock or split selectors',()=>{
  const css=fs.readFileSync(require('node:path').join(__dirname,'../ui/injections/laolao-reading-view.css'),'utf8');
  assert.doesNotMatch(css,/data-laolao-workspace-(?:dock|split)/);
  assert.match(css,/openclaw-chat-pane\[data-pinkie-reading-view\]/);
});
