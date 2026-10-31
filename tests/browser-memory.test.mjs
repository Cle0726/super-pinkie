import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createAppBrowserTool,BrowserSiteMemory,browserPageKey} from '../services/mode-architecture/app-browser.mjs';
const context={sessionKey:'agent:main:browser-memory'};
const elements=[{ref:'p1e1',role:'textbox',name:'备注',value:''},{ref:'p1e2',role:'combobox',name:'专业',options:[{value:'dz',label:'数字电路'}]},{ref:'p1e3',role:'slider',name:'进度',slider:{min:0,max:100}},
 {ref:'p1e4',role:'checkbox',name:'同意',checked:false},{ref:'p1e5',role:'button',name:'高级实验'},{ref:'p1e6',role:'button',name:'保存'},{ref:'p1e7',role:'textbox',name:'密码',protected:true}];
function fakeServers(file,{fail}={}){
 const calls=[];return {calls,memory:new BrowserSiteMemory(file),async request(action,params){calls.push({action,params});
  if(fail&&fail(action,params))return {ok:false,reason:'目标控件还没有出现。'};
  if(action==='open')return {ok:true,result:{page:{url:params.url},observation:{elements}}};
  if(action==='snapshot')return {ok:true,result:{elements}};
  return {ok:true,result:{page:{url:'http://127.0.0.1:65160/lab.html'}}};}};
}
const temp=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-memory-'));return path.join(dir,'site-memory.json');};

test('page keys ignore local ports, query strings and ids in paths',()=>{
 assert.equal(browserPageKey('http://127.0.0.1:65160/lab.html?x=1#a'),'local/lab.html');assert.equal(browserPageKey('http://localhost:3000/lab.html'),'local/lab.html');
 assert.equal(browserPageKey('https://Example.com/item/123/edit'),'example.com/item/:id/edit');assert.equal(browserPageKey('about:blank'),'');
});

test('a remembered trail is stored as portable role+name steps and announced on the next open',async()=>{
 const file=temp(),servers=fakeServers(file),tool=createAppBrowserTool(context,{servers});
 await tool.execute('o',{action:'open',url:'http://127.0.0.1:65160/lab.html'});
 const done=await tool.execute('b',{action:'batch',remember:'填写实验表单',steps:[{action:'hover',ref:'p1e5'},{action:'type',ref:'p1e1',text:'广西专升本验收'},{action:'select',ref:'p1e2',value:'dz'},{action:'set_slider',ref:'p1e3',sliderValue:73},{action:'click',ref:'p1e6'}]});
 assert.equal(done.isError,false);assert.equal(done.details.remembered.title,'填写实验表单');
 const disk=JSON.parse(fs.readFileSync(file,'utf8')),recipe=disk.pages['local/lab.html'].recipes[0];
 assert.equal(recipe.steps.some(step=>step.ref),false);assert.deepEqual(recipe.steps[0],{action:'hover',name:'高级实验',exact:true,role:'button'});
 assert.equal(recipe.steps[1].text,'{{备注}}');assert.deepEqual(recipe.vars,{备注:'广西专升本验收',专业:'dz',进度:'73'});
 assert.equal(fs.statSync(file).mode&0o077,0);
 // A new session (fresh memory from disk, different port) sees it immediately.
 const next=fakeServers(file),tool2=createAppBrowserTool({sessionKey:'agent:learning:other'},{servers:next});
 const opened=await tool2.execute('o2',{action:'open',url:'http://127.0.0.1:50001/lab.html'});
 assert.equal(opened.details.known[0].title,'填写实验表单');assert.match(opened.details.known[0].steps[0],/hover button「高级实验」/);
});

test('replay runs the saved steps in one call with new variable values and counts uses',async()=>{
 const file=temp(),servers=fakeServers(file),tool=createAppBrowserTool(context,{servers});
 await tool.execute('o',{action:'open',url:'http://127.0.0.1:65160/lab.html'});
 const saved=await tool.execute('b',{action:'batch',remember:'表单',steps:[{action:'type',ref:'p1e1',text:'旧'},{action:'set_slider',ref:'p1e3',sliderValue:10}]});
 const id=saved.details.remembered.id;servers.calls.length=0;
 const replay=await tool.execute('r',{action:'replay',recipe:id,vars:[{name:'备注',value:'新的备注'},{name:'进度',value:'42'}]});
 assert.equal(replay.isError,false);assert.deepEqual(servers.calls.map(c=>c.action),['type','set_slider','snapshot']);
 assert.equal(servers.calls[0].params.text,'新的备注');assert.equal(servers.calls[0].params.name,'备注');assert.equal(servers.calls[1].params.sliderValue,42);
 assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).pages['local/lab.html'].recipes[0].uses,1);
 const bad=await tool.execute('r2',{action:'replay',recipe:id,vars:[{name:'不存在',value:'x'}]});assert.equal(bad.isError,true);assert.match(bad.details.reason,/可用变量/);
});

test('replay from another page opens the saved page first; a failing auto recipe is dropped',async()=>{
 const file=temp(),servers=fakeServers(file),tool=createAppBrowserTool(context,{servers});
 await tool.execute('o',{action:'open',url:'http://127.0.0.1:65160/lab.html'});
 await tool.execute('a',{action:'click',ref:'p1e5'});await tool.execute('b',{action:'click',ref:'p1e6'});
 servers.memory.flush(context.sessionKey);
 const auto=servers.memory.recipes('local/lab.html')[0];assert.equal(auto.auto,true);assert.equal(auto.steps.length,2);
 const other=fakeServers(file,{fail:(action)=>action==='click'}),tool2=createAppBrowserTool({sessionKey:'agent:x'},{servers:other});
 const result=await tool2.execute('r',{action:'replay',recipe:auto.id});
 assert.equal(result.isError,true);assert.equal(other.calls[0].action,'open');assert.equal(other.calls[0].params.url,'http://127.0.0.1:65160/lab.html');
 assert.equal(result.details.failedIndex,0);assert.match(result.details.failedStep,/高级实验/);
 assert.equal(new BrowserSiteMemory(file).recipes('local/lab.html').length,0);
});

test('fill turns label/value pairs into typed steps from the last observation, skips settled checkboxes',async()=>{
 const servers=fakeServers(''),tool=createAppBrowserTool(context,{servers});
 await tool.execute('o',{action:'open',url:'http://127.0.0.1:65160/form.html'});servers.calls.length=0;
 const result=await tool.execute('f',{action:'fill',fields:[{name:'备注',value:'你好'},{name:'专业',value:'数字电路'},{name:'进度',value:'73'},{name:'同意',value:'是'},{name:'未出现的字段',value:'x'}],submitName:'保存'});
 assert.equal(result.isError,false);
 assert.deepEqual(servers.calls.map(c=>[c.action,c.params.ref||c.params.name]),[['type','p1e1'],['select','p1e2'],['set_slider','p1e3'],['click','p1e4'],['type','未出现的字段'],['click','保存'],['snapshot',undefined]]);
 assert.equal(servers.calls[2].params.sliderValue,73);
});

test('passwords are never written to memory and must be supplied on replay; batch can open a url first',async()=>{
 const file=temp(),servers=fakeServers(file),tool=createAppBrowserTool(context,{servers});
 const done=await tool.execute('b',{action:'batch',url:'https://example.com/login',remember:'登录',steps:[{action:'type',ref:'p1e7',text:'s3cret'},{action:'click',ref:'p1e6'}]});
 assert.equal(done.isError,false);assert.equal(servers.calls[0].action,'open');
 assert.doesNotMatch(fs.readFileSync(file,'utf8'),/s3cret/);
 const replay=await tool.execute('r',{action:'replay',recipe:done.details.remembered.id});assert.equal(replay.isError,true);assert.match(replay.details.reason,/密码/);
});
