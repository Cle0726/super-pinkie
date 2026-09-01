const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
function fixture(folder='/projects/current'){
  const sent=[],events=[],key='agent:project:one',state={pins:[],projects:{Current:[key]},projectFolders:folder?{Current:folder}:{},collapsed:{}};
  const store=new Map([['laolao.sidebar.v2.migrated','1'],['laolao.sidebar.v2.project',JSON.stringify(state)]]);
  class Socket { constructor(){this.readyState=1;this.handlers=[];}addEventListener(type,fn){if(type==='message')this.handlers.push(fn);}send(data){sent.push(JSON.parse(data));}dispatchEvent(e){events.push(JSON.parse(e.data));for(const h of this.handlers)h(e);}}
  class Element{constructor(){this.classList={add(){},remove(){}};}setAttribute(){} }
  const toast=new Element();
  const document={readyState:'loading',documentElement:{getAttribute:()=> 'project'},querySelector:sel=>sel==='.laolao-toast'?toast:null,addEventListener(){}};
  const window={WebSocket:Socket,addEventListener(){}};
  const localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../ui/injections/laolao-sidebar.js'),'utf8'),{window,document,location:{href:'http://127.0.0.1:18789/?session='+key},localStorage,URL,URLSearchParams,setTimeout,clearTimeout,setInterval:()=>0,requestAnimationFrame:fn=>fn(),MutationObserver:class{observe(){}},MessageEvent:class{constructor(type,data){this.type=type;this.data=data.data;}}});
  const ws=new window.WebSocket('ws://127.0.0.1:18789/');
  const send=()=>ws.send(JSON.stringify({type:'req',id:'user-send',method:'chat.send',params:{sessionKey:key,message:'做项目'}}));
  const reply=(ok=true)=>{const request=sent.find(r=>r.method==='pinkie.project.bind');ws.dispatchEvent({data:JSON.stringify({type:'res',id:request.id,ok,payload:{binding:{root:folder}},error:{message:'目录校验失败'}})});};
  const abort=()=>ws.send(JSON.stringify({type:'req',id:'cancel',method:'chat.abort',params:{sessionKey:key}}));
  return{sent,events,send,reply,abort};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('message waits for authenticated project binding before reaching model',async()=>{
  const f=fixture();f.send();await tick();assert.deepEqual(f.sent.map(r=>r.method),['pinkie.project.bind']);
  assert.equal(f.sent[0].params.path,'/projects/current');f.reply();await tick();assert.deepEqual(f.sent.map(r=>r.method),['pinkie.project.bind','chat.send']);
});
test('failed project binding sends an RPC error and never forwards chat',async()=>{
  const f=fixture();f.send();await tick();f.reply(false);await tick();
  assert.ok(!f.sent.some(r=>r.method==='chat.send'));assert.ok(f.events.some(e=>e.id==='user-send'&&!e.ok));
});
test('a named group without a folder cannot pretend to be a working project',async()=>{
  const f=fixture(null);f.send();await tick();assert.equal(f.sent.length,0);assert.ok(f.events.some(e=>e.id==='user-send'&&!e.ok));
});
test('cancel during binding prevents a late model request',async()=>{
  const f=fixture();f.send();await tick();f.abort();f.reply();await tick();
  assert.ok(!f.sent.some(r=>r.method==='chat.send'));assert.ok(f.events.some(e=>e.id==='user-send'&&!e.ok));
});
