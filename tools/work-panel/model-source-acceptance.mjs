// Production picker DOM and handlers on a private port, with an isolated catalog.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import http from 'node:http';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../../',import.meta.url)),ui=process.env.PINKIE_QA_UI || path.join(repo,'ui/injections');
const out=process.env.PINKIE_WORK_OUTPUT || path.join(os.tmpdir(),'pinkie-model-source-qa');fs.mkdirSync(out,{recursive:true});
const models=['sonnet','opus'].flatMap(family=>['','-low','-medium','-high'].map(suffix=>({provider:'mm',id:'claude-'+family+'-5-5'+suffix,name:'Claude '+family[0].toUpperCase()+family.slice(1)+' 5.5'+(suffix?suffix.replace('-',' '):''),reasoning:false,input:['text'],contextWindow:suffix?128000:1000000})));
const html=`<!doctype html><html data-laolao-mode="learning" data-pinkie-night><meta charset="utf-8"><link rel="stylesheet" href="/laolao-theme.css"><link rel="stylesheet" href="/laolao-model-picker.css"><style>body{margin:0;padding:24px;background:#211a29;color:#f5e5f1;font:14px system-ui}main{max-width:740px;margin:0 auto;padding-bottom:420px}.chat-controls__inline-select-menu--combined{position:relative!important;inset:auto!important;transform:none!important}.chat-controls__model{display:inline-block;position:relative}summary{padding:12px;cursor:pointer}.agent-chat__composer-actions{display:flex;gap:12px}</style><main><p>Claude 双来源 · 隔离组件验收</p><div class="agent-chat__composer-actions"><details id="picker" class="chat-controls__model" data-session-key="agent:learning:source-qa"><summary>模型</summary><div class="chat-controls__inline-select-menu--combined" data-pinkie-picker-surface><input class="chat-controls__model-search" placeholder="搜索模型"><div class="chat-controls__model-browser chat-controls__model-options"></div><div class="chat-controls__reasoning-panel"><div class="chat-controls__reasoning-slider"></div></div></div></details></div></main><script>window.qaModels=${JSON.stringify(models)};window.qaCalls=[];window.qaSession={key:'agent:learning:source-qa',modelProvider:'mm',model:'claude-sonnet-5-5',thinkingLevel:'off',thinkingLevels:['off'],hasActiveRun:false};window.__laolaoSidebar={gwRequest:async(method,params)=>{qaCalls.push({method,params});if(method==='chat.metadata')return {models:qaModels};if(method==='sessions.list')return {sessions:[{...qaSession}]};if(method==='sessions.patch'){if(params.model){const i=params.model.indexOf('/');qaSession.modelProvider=params.model.slice(0,i);qaSession.model=params.model.slice(i+1);}if(params.thinkingLevel)qaSession.thinkingLevel=params.thinkingLevel;return {ok:true};}return {};}};</script><script src="/laolao-model-picker.js"></script><script>window.qaOpen=view=>qaPicker.openPickerView(document.querySelector('#picker'),view);</script>`;
const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://loopback').pathname.slice(1);if(!name){res.setHeader('Content-Type','text/html;charset=utf-8');return res.end(html);}
  if(!/^laolao-[\w-]+\.(js|css|png)$/.test(name)){res.writeHead(404);return res.end();}
  const file=[path.join(ui,name),path.join(repo,'ui/assets',name)].find(file=>fs.existsSync(file));if(!file){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'image/png');
  const body=fs.readFileSync(file);res.end(name==='laolao-model-picker.js'?body.toString().replace(/\}\)\(\);\s*$/,'window.qaPicker={openPickerView};})();'):body);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
const require=createRequire(import.meta.url),{chromium,webkit}=require('/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const report={status:'pending',engines:{}};
try{
 for(const [engine,type] of Object.entries({chromium,webkit})){
  const browser=await type.launch(engine==='chromium'?{channel:'chrome',headless:true}:{headless:true}),page=await browser.newPage({viewport:{width:1000,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  try{
   await page.goto(base);await page.evaluate(()=>qaOpen('model'));await page.locator('.pinkie-fallback-option').first().waitFor({state:'attached'});
   const all=page.locator('[data-pinkie-model-filter="all"]');if(await all.count())await all.click();
   const names=await page.locator('.pinkie-fallback-option').allTextContents();assert.equal(names.length,4);assert.equal(names.filter(n=>/ ·At$/.test(n)).length,2);
   for(const family of ['sonnet','opus']){
    await page.evaluate(()=>qaOpen('model'));if(await all.count())await all.click();
    const baseId='claude-'+family+'-5-5';
    await page.locator('[data-chat-model-option="mm/'+baseId+'-low"]').click();
    await page.waitForFunction(prefix=>qaSession.model.startsWith(prefix+'-'),baseId);
    await page.evaluate(()=>qaOpen('effort'));
    const range=page.locator('.chat-controls__reasoning-range[data-pinkie-fallback]');await range.waitFor();
    for(const [index,level] of ['off','minimal','low','medium','high','xhigh','adaptive','max','ultra'].entries()){
      await range.fill(String(index));const suffix=({off:'low',minimal:'low',low:'low',medium:'medium',high:'high',xhigh:'high',adaptive:'high',max:'high',ultra:'high'})[level];
      await page.waitForFunction(target=>qaSession.model===target&&qaCalls.some(c=>c.method==='sessions.patch'&&c.params.model==='mm/'+target&&c.params.thinkingLevel==='off'),baseId+'-'+suffix);
      assert.equal(await range.inputValue(),String(index));
    }
    await page.evaluate(()=>qaOpen('model'));if(await all.count())await all.click();
    await page.locator('[data-chat-model-option="mm/'+baseId+'"]').click();
    await page.waitForFunction(target=>qaSession.model===target,baseId);
    await page.evaluate(()=>qaOpen('effort'));await range.fill('8');
    await page.waitForFunction(()=>qaCalls.at(-1)?.method==='sessions.list');
    assert.equal(await page.evaluate(()=>qaSession.model),baseId,'Account pool stays selected at custom Ultra');
   }
   assert.deepEqual(errors,[]);report.engines[engine]={status:'passed',modelNames:names,sliderCases:18,accountPoolsPreserved:2,errors};
  }finally{await browser.close();}
 }
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack||error);throw error;}
finally{server.close();fs.writeFileSync(path.join(out,'model-source-acceptance.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
