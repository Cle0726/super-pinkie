const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../ui/injections/laolao-material-preview.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
 const posted=[],events=new Map(),timers=new Map(),nodes=[];let id=0,now=0;
 const document={querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},createElement:()=>({style:{},remove(){const i=nodes.indexOf(this);if(i>=0)nodes.splice(i,1);}}),body:{append:node=>nodes.push(node)}};
 const window={innerWidth:1000,innerHeight:800,navigator:{},localStorage:{getItem(){return null;}},webkit:{messageHandlers:{laolaoBrowserWorkspace:{postMessage:p=>posted.push(p)},laolaoMaterialPreview:{postMessage:p=>posted.push(p)}}},addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name),setTimeout:(fn,ms)=>{timers.set(++id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(source.replace(/\}\)\(\);\s*$/,'window.qa={runFileAction};})();'),{window,document,URL,Map,WeakMap,Promise,Date,Math,AbortController,Element:class{},Node:{TEXT_NODE:3}});
 return {posted,nodes,run:()=>window.qa.runFileAction({path:'/Users/qa/answer.md',name:'answer.md',kind:'text'},'preview'),advance:ms=>{now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}},ack:(ok,path='/Users/qa/answer.md')=>events.get('laolao:browser-show-file')?.({detail:{path,ok,reason:ok?'':'测试预览失败'}})};
}
test('a late browser acknowledgement cannot create a second preview panel',async()=>{
 const h=harness();h.run();h.run();assert.equal(h.posted.length,1,'Double click shares one native request');h.advance(2000);await tick();
 assert.equal(h.nodes.length,0);assert.equal(h.posted.length,1);h.ack(true,'/Users/qa/other.md');await tick();assert.equal(h.nodes.length,0);h.ack(true);await tick();assert.equal(h.nodes.length,0);assert.deepEqual(h.posted.map(p=>p.action),['show-file']);
});
test('browser errors and timeouts show a short error instead of opening another viewer',async()=>{
 for(const timeout of [false,true]){const h=harness();h.run();if(timeout)h.advance(8000);else h.ack(false);await tick();assert.equal(h.nodes.length,1);assert.match(h.nodes[0].className,/--error/);assert.deepEqual(h.posted.map(p=>p.action),['show-file']);h.ack(true);await tick();assert.equal(h.nodes.length,1);}
});
