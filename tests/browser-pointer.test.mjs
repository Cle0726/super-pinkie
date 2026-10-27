import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppBrowserTool} from '../services/mode-architecture/app-browser.mjs';
const ctx={sessionKey:'agent:learning:pointer-tests'};
test('pointer actions use the same global tool and carry native gesture parameters',async()=>{
 const calls=[],tool=createAppBrowserTool(ctx,{servers:{async request(action,params){calls.push({action,params});return {ok:true,result:{input:'native'}};}}});
 for(const p of [{action:'hover',selector:'#menu'},{action:'move',x:20,y:30},{action:'drag',ref:'p1e1',toRef:'p1e2',durationMs:320},{action:'click',selector:'#canvas',input:'native',clickCount:2},{action:'scroll',selector:'#table',dx:120},{action:'set_slider',name:'频率',sliderValue:73},{action:'drag',name:'节点',toName:'目标区'}])assert.equal((await tool.execute('p',p)).isError,false);
 assert.deepEqual(calls.map(c=>c.action),['hover','move','drag','click','scroll','set_slider','drag']);assert.equal(calls[2].params.toRef,'p1e2');
});
test('invalid drag and coordinate arguments fail before any page effects, including in a batch',async()=>{
 const calls=[],tool=createAppBrowserTool(ctx,{servers:{async request(action){calls.push(action);return {ok:true,result:{}};}}});
 for(const p of [{action:'set_slider',name:'频率'},{action:'hover',x:1},{action:'move',x:-1,y:2},{action:'drag',ref:'a'},{action:'drag',ref:'a',toRef:'b',toX:2,toY:3},{action:'drag',ref:'a',toX:1,toY:2,durationMs:9000},{action:'click',ref:'a',input:'unknown'}])assert.equal((await tool.execute('bad',p)).isError,true);
 const bad=await tool.execute('batch',{action:'batch',steps:[{action:'hover',selector:'#menu'},{action:'drag',ref:'a',toRef:'b',durationMs:1}]});assert.equal(bad.isError,true);assert.deepEqual(calls,[]);
});
test('mixed hover and drag batch observes once and cannot be interrupted by another mode write',async()=>{
 let resume;const calls=[],servers={async request(action){calls.push(action);if(action==='drag')await new Promise(r=>resume=r);return {ok:true,result:{}};}};
 const a=createAppBrowserTool(ctx,{servers}),b=createAppBrowserTool({sessionKey:'agent:project:pointer-tests'},{servers});
 const pending=a.execute('batch',{action:'batch',steps:[{action:'hover',selector:'#menu'},{action:'drag',ref:'a',toRef:'b'}]});
 while(!resume)await new Promise(r=>setImmediate(r));
 assert.equal((await b.execute('move',{action:'move',x:1,y:1})).isError,true);assert.equal((await b.execute('status',{action:'status'})).isError,false);
 resume();assert.equal((await pending).isError,false);assert.deepEqual(calls,['hover','drag','status','snapshot']);
});
test('native partial execution flags survive the agent tool response',async()=>{
 const tool=createAppBrowserTool(ctx,{servers:{async request(){return {ok:false,reason:'用户接管',mayHaveExecuted:true,nextAction:'snapshot-before-retry'};}}});
 const result=await tool.execute('drag',{action:'drag',ref:'a',toRef:'b'});assert.equal(result.isError,true);assert.equal(result.details.mayHaveExecuted,true);assert.equal(result.details.nextAction,'snapshot-before-retry');
});
