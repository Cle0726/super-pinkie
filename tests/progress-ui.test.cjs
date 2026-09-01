const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

test('native streaming display enabled once for all four modes without model/context/persona edits',()=>{
  for(const mode of ['main','project','thinking','unrestricted']){
    const saved=new Map(),settings={chatShowThinking:false,chatShowToolCalls:false,chatPersistCommentary:false,chatAutoScroll:'near-bottom',model:'user-model',contextTokens:987654};
    const messages=[{role:'assistant',content:'我将检查系统中可用的 OCR 工具。'}];
    const pane={classList:{add(){}},state:{sessionKey:`agent:${mode}:test`,assistantName:'助手',messages,settings,applySettings(v){this.settings=v;}}};
    let observer;
    const ctx={document:{body:{},querySelectorAll:()=>[pane],readyState:'complete'},window:{addEventListener(){}},localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},requestAnimationFrame:fn=>fn(),MutationObserver:class{constructor(fn){observer=fn}observe(){}}};
    vm.runInNewContext(read('ui/injections/laolao-progress.js'),ctx);
    assert.equal(pane.state.settings.chatShowToolCalls,true);assert.equal(pane.state.settings.chatPersistCommentary,true);
    assert.equal(pane.state.settings.chatShowThinking,false);assert.equal(pane.state.settings.contextTokens,987654);assert.equal(pane.state.settings.model,'user-model');
    assert.equal(pane.state.assistantName,'碧琪');assert.equal(messages[0].content,'我将检查系统中可用的 OCR 工具。');
    pane.state.settings.chatShowToolCalls=false;observer();assert.equal(pane.state.settings.chatShowToolCalls,false,'later explicit preference is respected');
  }
});

test('work stream presentation uses public events and native image previews without exposing hidden reasoning',()=>{
  const progress=read('ui/injections/laolao-progress.js');
  const css=read('ui/injections/laolao-theme.css');
  const viewer=read('ui/injections/laolao-image-viewer.js');
  assert.match(progress,/laolao:public-progress:v2/);
  assert.match(progress,/chatShowToolCalls:true,chatPersistCommentary:true/);
  assert.doesNotMatch(progress,/chatShowThinking:true/);
  assert.match(css,/\.chat-bubble\.streaming/);
  assert.match(css,/\.chat-activity-group/);
  assert.match(css,/\.chat-tool-msg-collapse/);
  assert.match(css,/\.chat-tool-card__preview\[data-kind="image"\]/);
  assert.match(viewer,/\.chat-message-image, \.chat-tool-card__preview-image, \.cm-image img/);
});

function textFixture(value,{role='assistant',kind='reply',quoted=false,sentinel=true}={}){
  const attrs=new Map(sentinel?[['data-message-text','The agent run failed before producing a reply.']]:[]);
  const bubble={getAttribute:k=>attrs.get(k),setAttribute:(k,v)=>attrs.set(k,v)};
  const text={textContent:value};
  const parent={hasAttribute:()=>false,closest:selector=>{
    if(selector==='.chat-group.assistant')return role==='assistant'?{}:null;
    if(selector==='.chat-text')return kind==='reply'?text:null;
    if(selector==='.chat-bubble')return bubble;
    if(selector.startsWith('pre, code, blockquote'))return quoted?{}:null;
    if(selector.startsWith('pre, code,'))return kind==='reply'||kind==='tool'?{}:null;
    if(selector.startsWith('.chat-group.assistant .chat-sender-name'))return kind==='name'&&role==='assistant'?{}:null;
    return null;
  }};
  const source=read('ui/injections/laolao-phrases.js');
  const {localizeText}=vm.runInNewContext(source.slice(0,source.indexOf('  const localizeTree ='))+'return {localizeText};})();',{Node:{TEXT_NODE:3}});
  const node={nodeType:3,parentElement:parent,nodeValue:value};localizeText(node);
  return {node,attrs,localizeText};
}
test('reserved runtime failure gets a Chinese system label without changing stored text',()=>{
  const raw='The agent run failed before producing a reply.';
  const f=textFixture(raw);assert.equal(f.node.nodeValue,'这次模型调用失败，碧琪暂时没能完成回复。');
  assert.equal(f.attrs.get('data-pinkie-runtime-error'),'true');assert.equal(f.attrs.get('data-message-text'),raw);
  f.localizeText(f.node);assert.equal(f.node.nodeValue,'这次模型调用失败，碧琪暂时没能完成回复。');
});
test('UI localization leaves user messages, quotes, technical prose and tool output untouched',()=>{
  for(const [value,options] of [
    ['The agent run failed before producing a reply.',{role:'user'}],
    ['The agent run failed before producing a reply.',{quoted:true}],
    ['The agent run failed before producing a reply.',{sentinel:false}],
    ['我将检查 tesseract 和 Vision，识别图片文字。',{}],
    ['助手',{}],['Loading…',{kind:'tool'}],
  ])assert.equal(textFixture(value,options).node.nodeValue,value);
  assert.equal(textFixture('助手',{kind:'name'}).node.nodeValue,'碧琪');
  assert.equal(textFixture('助手',{kind:'name',role:'user'}).node.nodeValue,'助手');
});

test('room stream closes on switch, rejects old epochs and old HTTP snapshots',()=>{
  const src=read('ui/party/party.js');
  assert.match(src,/state\.live\?\.close\(\)/);
  assert.match(src,/state\.room\?\.id!==roomId\|\|state\.epoch!==epoch\|\|state\.live!==source/);
  assert.match(src,/liveVersion!==state\.liveVersion/);
  assert.match(src,/new EventSource\(`/);
  assert.doesNotMatch(src,/replaceChildren\(\.\.\.ordered\.map\(messageNode\)\)/);
  assert.match(src,/row\._message\|\|message/);
  assert.match(src,/if\(pinned\)timeline\.scrollTop/);
});

test('OpenClaw tap drops reasoning and carries actual assistant/tool events',async()=>{
  const {publicEvent}=await import('../services/party/openclaw-live.mjs');
  assert.equal(publicEvent({stream:'reasoning',data:{text:'private'}}),null);
  assert.equal(publicEvent({stream:'assistant',data:{text:'已完成检查'}}).data.text,'已完成检查');
  assert.equal(publicEvent({stream:'tool',data:{name:'read',toolCallId:'t',phase:'start'}}).data.name,'read');
});

test('tool labels retain actual paths and commands instead of fabricated progress',()=>{
  const src=read('ui/injections/laolao-phrases.js');
  assert.doesNotMatch(src,/detail\.textContent = (?:detailPhrase|cardDetailPhrase)/);
  assert.match(src,/toolLabel\.textContent=label\+' · '\+rawToolName/);
});
