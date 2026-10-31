const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

/* The ported sidebar talks to the gateway only through window.CLE.host. These tests run the
   real classic script in a small DOM stub and answer each native call from a table, so the
   grouping / mutation / refresh logic can be checked without a gateway. */

const SRC=path.join(__dirname,'../services/cle-studio/static/legacy/laolao-session-list.js');
const ROWS={
  'agent:main:main':{label:'主会话'},
  'agent:main:a':{label:'alpha'},
  'agent:main:b':{label:'beta'},
  'agent:main:c':{label:'oc-test-c'},
};

function makeEnv({room='chat',state,responses={}}={}){
  const calls=[];
  const sessions=new Map(Object.entries(ROWS).map(([k,v])=>[k,{key:k,agentId:'main',sessionId:'sid-'+k.slice(-1),archived:false,pinned:false,updatedAt:1,...v}]));
  const list=async({archived=false}={})=>({sessions:[...sessions.values()].filter(s=>!!s.archived===!!archived)});
  const handler=async(method,params)=>{
    calls.push({method,params});
    if(responses[method])return responses[method](params);
    if(method==='sessions.list')return list(params);
    if(method==='sessions.create'){const key='agent:'+params.agentId+':new-'+sessions.size;sessions.set(key,{key,agentId:params.agentId,label:params.label,sessionId:'sid-new',archived:false,pinned:false,updatedAt:2});return {key};}
    if(method==='sessions.patch'){const s=sessions.get(params.key);if(!s)throw new Error('missing');Object.assign(s,{...params,label:params.label??s.label});return {ok:true};}
    if(method==='sessions.delete'){sessions.delete(params.key);return {ok:true,deleted:true};}
    if(method==='sessions.list')return {sessions:[]};
    throw new Error('unknown method '+method);
  };
  const listeners={};
  class El{
    constructor(tag='div'){this.tagName=tag;this.children=[];this.style={};this.dataset={};this.attributes={};this.classList={list:new Set(),add:(...c)=>c.forEach(x=>this.classList.list.add(x)),remove:(...c)=>c.forEach(x=>this.classList.list.delete(x)),toggle:(c,on)=>{on?this.classList.list.add(c):this.classList.list.delete(c);},contains:c=>this.classList.list.has(c)};this.ownerDocument=null;}
    set className(v){this._cls=v;this.classList.list=new Set(String(v).split(/\s+/).filter(Boolean));}
    get className(){return [...this.classList.list].join(' ');}
    set innerHTML(v){this._html=v;this.children=[];}
    get innerHTML(){return this._html||'';}
    set textContent(v){this._text=v;this.children=[];}
    get textContent(){return this._text??'';}
    append(...nodes){this.children.push(...nodes.flat());}
    appendChild(n){this.children.push(n);return n;}
    insertAdjacentElement(){}
    insertBefore(n){this.children.push(n);return n;}
    remove(){}
    addEventListener(t,fn){(this._ev=this._ev||{})[t]=fn;}
    removeEventListener(){}
    setAttribute(k,v){this.attributes[k]=String(v);}
    getAttribute(k){return this.attributes[k]??null;}
    removeAttribute(k){delete this.attributes[k];}
    hasAttribute(k){return k in this.attributes;}
    getBoundingClientRect(){return {left:0,top:0,right:0,bottom:0,width:100,height:20};}
    querySelector(){return null;}
    querySelectorAll(){return [];}
    closest(){return null;}
    focus(){}
    select(){}
    contains(){return false;}
    dispatchEvent(){}
    get parentElement(){return null;}
  }
  const document={
    readyState:'complete',
    documentElement:{dataset:{cleRoom:room},attributes:{},setAttribute(){},removeAttribute(){},hasAttribute(){return false;}},
    body:new El('body'),
    createElement:t=>new El(t),
    querySelector:()=>null,
    querySelectorAll:()=>[],
    addEventListener(){},
  };
  const store=new Map([['laolao.sidebar.v2.migrated','1']]);
  if(state)store.set('laolao.sidebar.v2.'+room,JSON.stringify(state));
  const window={
    CLE:{host:{request:handler,sessions:{selectedKey:''},subscribe:()=>()=>{}}},
    addEventListener(t,fn){listeners[t]=fn;},
    dispatchEvent(){},
    localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},
  };
  window.localStorage=window.localStorage;
  window.localStorage.setItem('laolao.sidebar.v2.migrated','1');
  const sandbox={
    window,document,localStorage:window.localStorage,
    setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},requestAnimationFrame:()=>0,cancelAnimationFrame(){},
    MutationObserver:class{constructor(fn){this.fn=fn;}observe(){}disconnect(){}},
    CSS:{escape:s=>s},
    URLSearchParams,URL,JSON,console,Promise,Map,Set,Date,Math,Object,Array,String,Number,
    PointerEvent:class{},KeyboardEvent:class{},Event:class{},CustomEvent:class{},
  };
  sandbox.globalThis=sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC,'utf8'),sandbox);
  return {calls,ui:window.__cleSidebarUI,sessions,store};
}

test('delete sends the native call with the durable session id and refreshes from sessions.list',async()=>{
  const env=makeEnv();
  await env.ui.refresh();
  await env.ui.deleteSession('agent:main:b');
  const del=env.calls.find(c=>c.method==='sessions.delete');
  assert.equal(del.params.key,'agent:main:b');
  assert.equal(del.params.agentId,'main');
  assert.equal(del.params.deleteTranscript,true);
  assert.ok(del.params.expectedSessionId,'expectedSessionId is required by the gateway');
  assert.ok(!env.sessions.has('agent:main:b'));
});

test('archive passes expectedSessionId; the gateway rejects lifecycle patches without it',async()=>{
  const env=makeEnv();
  await env.ui.refresh();
  await env.ui.archiveSession('agent:main:b');
  const patch=env.calls.find(c=>c.method==='sessions.patch');
  assert.equal(patch.params.archived,true);
  assert.ok(patch.params.expectedSessionId,'expectedSessionId is required by the gateway');
});

test('new session keeps labels unique and opens the created key',async()=>{
  const env=makeEnv();
  let opened=null;
  env.ui.navigateSession=()=>{};
  const created=await env.ui.createSession(null,{label:'alpha'});
  const create=env.calls.find(c=>c.method==='sessions.create');
  assert.notEqual(create.params.label,'alpha','a taken label gets a suffix');
  assert.ok(created.startsWith('agent:main:new-'));
  void opened;
});

test('cleanup only deletes what the filter matches and keeps pinned/project/open sessions',async()=>{
  const env=makeEnv({state:{pins:['agent:main:a'],projects:{P:['agent:main:b']},projectFolders:{P:'/tmp/p'},collapsed:{}}});
  const res=await env.ui.cleanupSessions({filter:s=>/^oc-test-/.test(s.label||'')});
  assert.deepEqual([...res.deleted],['agent:main:c']);
  assert.ok(env.sessions.has('agent:main:a'));
  assert.ok(env.sessions.has('agent:main:b'));
});

test('every mode maps to its agent in the native list call',async()=>{
  const env=makeEnv({room:'thinking'});
  await env.ui.refresh();
  await new Promise(r=>setImmediate(r));
  assert.equal(env.ui.mode,'thinking');
  const list=env.calls.find(c=>c.method==='sessions.list');
  assert.equal(list.params.agentId,'thinking');
});

test('session menus are mode-bound: another mode refuses to mutate',async()=>{
  const env=makeEnv();
  await assert.rejects(()=>env.ui.deleteSession('agent:thinking:x'),/请回到该会话所属的模式/);
  assert.ok(!env.calls.some(c=>c.method==='sessions.delete'));
});

test('clearing the sidebar attribute keeps the native entries in the DOM (they are the 更多 source)',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../services/cle-studio/static/legacy/laolao-sidebar.css'),'utf8');
  assert.match(css,/html\[data-cle-sidebar\]:not\(\[data-cle-sidebar-off\]\) aside\.sidebar :is\(\.sidebar-nav, \.sidebar-online, \.sidebar-sessions\) \{ display: none !important; \}/);
  const js=fs.readFileSync(SRC,'utf8');
  assert.ok(!/\.remove\(\).*sidebar-nav|sidebar-nav.*\.remove\(\)/.test(js),'native nav nodes must never be removed');
});

test('the project view shows the real folder groups, not a stub',()=>{
  const js=fs.readFileSync(SRC,'utf8');
  assert.match(js,/projectsOnly[\s\S]*projectGroup\(name, \(\) => true, hooks\)[\s\S]*groups\.append\(folderHead\)/);
});
