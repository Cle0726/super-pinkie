import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createAppBrowserTool} from '../services/mode-architecture/app-browser.mjs';
const context={sessionKey:'agent:learning:browser-fixture'};
test('native embeds the exact independently tested browser helper and retains its safety boundary',()=>{
 const swift=fs.readFileSync(new URL('../desktop/macos/Sources/BrowserControl.swift',import.meta.url),'utf8'),js=fs.readFileSync(new URL('../desktop/macos/Sources/BrowserControl.js',import.meta.url),'utf8').trimEnd();
 const embedded=swift.split('private static let domScript = #"""\n')[1].split('\n    """#')[0].split('\n').map(line=>line.slice(4)).join('\n');assert.equal(embedded,js);
 assert.match(swift,/self\.userUntil > Date\(\)/);assert.match(swift,/BrowserControlPolicy\.allowsEvaluation/);assert.match(swift,/collaborationActive/);
});
test('batch validates every step before doing any work and observes once',async()=>{
 const calls=[],servers={async request(action,params){calls.push({action,params});return {ok:true,result:{action}};}};const tool=createAppBrowserTool(context,{servers});
 const bad=await tool.execute('bad',{action:'batch',steps:[{action:'type',ref:'p1e1',text:'x'},{action:'eval',js:'bad'}]});assert.equal(bad.isError,true);assert.equal(calls.length,0);
 const good=await tool.execute('good',{action:'batch',steps:[{action:'type',ref:'p1e1',text:'hello'},{action:'select',ref:'p1e2',value:'CN'},{action:'click',ref:'p1e3'}]});assert.equal(good.isError,false);assert.deepEqual(calls.map(c=>c.action),['type','select','click','snapshot']);assert.equal(calls[0].params.observe,false);assert.equal(good.details.completed.length,3);
});
test('partial batch failure reports completed prefix, never retries it, and releases its lease',async()=>{
 const calls=[],servers={async request(action){calls.push(action);return action==='click'?{ok:false,reason:'stale ref'}:{ok:true,result:{done:true}};}};const tool=createAppBrowserTool(context,{servers});
 const result=await tool.execute('partial',{action:'batch',steps:[{action:'type',ref:'p1e1',text:'x'},{action:'click',ref:'stale'},{action:'press',key:'Enter'}]});assert.equal(result.isError,true);assert.equal(result.details.completed.length,1);assert.equal(result.details.failedIndex,1);assert.equal(result.details.replay,false);assert.equal(result.details.mayHaveExecuted,true);assert.equal(result.details.nextAction,'snapshot-before-retry');assert.deepEqual(calls,['type','click']);
 const next=await tool.execute('next',{action:'type',ref:'p1e1',text:'next'});assert.equal(next.isError,false);
});
test('concurrent modes cannot interleave writes into a batch; read-only state stays available',async()=>{
 let release;const calls=[],servers={async request(action){calls.push(action);if(action==='type')await new Promise(resolve=>release=resolve);return {ok:true,result:{}};}};
 const learning=createAppBrowserTool(context,{servers}),project=createAppBrowserTool({sessionKey:'agent:project:browser-fixture'},{servers});
 const pending=learning.execute('batch',{action:'batch',observe:false,steps:[{action:'type',ref:'p1e1',text:'x'}]});await Promise.resolve();
 const blocked=await project.execute('other',{action:'click',ref:'p1e2'});assert.equal(blocked.isError,true);assert.deepEqual(calls,['type']);
 assert.equal((await project.execute('status',{action:'status'})).isError,false);release();assert.equal((await pending).isError,false);
});
test('new read, locate and select actions are available through the shared tool without remote eval',async()=>{
 const calls=[],servers={async request(action,p){calls.push([action,p]);return {ok:true,result:{}};}};const tool=createAppBrowserTool(context,{servers});
 for(const p of [{action:'locate',role:'button',name:'继续'},{action:'read',maxChars:4000},{action:'select',ref:'p1e1',value:'CN'}])assert.equal((await tool.execute('test',p)).isError,false);
 assert.deepEqual(calls.map(c=>c[0]),['locate','read','select']);assert.ok(tool.parameters.properties.action.enum.includes('batch'));
});

test('aborting a socket request sends cancellation for its exact native request, without repeating the action', async()=>{
 const {requestAppBrowser}=await import('../services/mode-architecture/app-browser.mjs');const net=await import('node:net');const os=await import('node:os');const path=await import('node:path');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-browser-cancel-test-'));fs.chmodSync(root,0o700);const socketPath=path.join(root,'control.sock'),bodies=[],clients=new Set();let accepted;const started=new Promise(r=>accepted=r);let cancelled;const cancelledCall=new Promise(r=>cancelled=r);
 const server=net.createServer(socket=>{clients.add(socket);socket.on('close',()=>clients.delete(socket));socket.on('error',()=>{});let buffer='';socket.on('data',data=>{buffer+=data;const at=buffer.indexOf('\n');if(at<0)return;const body=JSON.parse(buffer.slice(0,at));buffer='';bodies.push(body);if(body.action==='cancel'){cancelled(body);socket.end(JSON.stringify({id:body.id,ok:true,result:{cancelled:true}})+'\n');}else accepted(body);});});
 try{await new Promise(r=>server.listen(socketPath,r));fs.chmodSync(socketPath,0o600);const controller=new AbortController();const promise=requestAppBrowser('click',{selector:'#late'},{environment:{PINKIE_APP_BROWSER_ENDPOINT:JSON.stringify({socketPath,token:'test-token'})},signal:controller.signal});const request=await started;controller.abort();await assert.rejects(promise,/取消/);const cancel=await cancelledCall;assert.equal(cancel.requestId,request.id);assert.equal(cancel.token,'test-token');assert.deepEqual(bodies.map(x=>x.action),['click','cancel']);}
 finally{for(const socket of clients)socket.destroy();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
});

test('conditional waits and local container scrolling work in a validated batch',async()=>{
 const calls=[],servers={async request(action,params){calls.push({action,params});return {ok:true,result:{}};}};const tool=createAppBrowserTool(context,{servers});
 const reply=await tool.execute('dynamic',{action:'batch',steps:[{action:'wait',name:'保存',role:'button',waitFor:'enabled'},{action:'scroll',selector:'#table'},{action:'wait',selector:'#spinner',waitFor:'hidden'}]});assert.equal(reply.isError,false);assert.equal(calls[0].params.waitFor,'enabled');assert.equal(calls[1].params.selector,'#table');assert.equal(calls[2].params.waitFor,'hidden');
});
