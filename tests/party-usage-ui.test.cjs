const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const js=fs.readFileSync(path.join(__dirname,'../ui/injections/laolao-usage-stats.js'),'utf8');
function harness(payload){
  const pending=[],urls=[];
  const ctx={window:{},document:{getElementById:()=>({}),querySelector:()=>null,readyState:'loading',addEventListener:()=>{}},fetch:async url=>{urls.push(url);return {ok:true,json:async()=>payload}},setTimeout:fn=>pending.push(fn),setInterval:()=>{},MutationObserver:class{observe(){}},Date};
  vm.createContext(ctx);vm.runInContext(js.replace('      render();','      /* rendering tested in browser */'),ctx);
  return {ctx,urls};
}
test('party fetches persistent usage and preserves unknown values without guessing cost',async()=>{
  const {ctx,urls}=harness({scope:'lifetime',input:1000,output:200,cacheRead:700,cacheWrite:25,cost:6.75,source:'本机接口累计'});
  await ctx.window.__laolaoUsage.refresh();
  assert.deepEqual(urls,['/api/usage']);const v=ctx.window.__laolaoUsage.view;
  assert.equal(v.cost,6.75);assert.equal(v.cacheWrite,25);assert.equal(v.persistent,true);
  const unknown=harness({scope:'lifetime',input:null,output:null,cost:null});await unknown.ctx.window.__laolaoUsage.refresh();
  assert.equal(unknown.ctx.window.__laolaoUsage.view.input,null);assert.equal(unknown.ctx.window.__laolaoUsage.view.cost,null);
});
test('stats use light chips instead of bringing back the removed room header',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../ui/party/index.html'),'utf8');
  assert.match(html,/id="party-usage"/);assert.doesNotMatch(html,/class="chat-header"/);
  const css=fs.readFileSync(path.join(__dirname,'../ui/injections/laolao-usage-stats.css'),'utf8');
  assert.match(css,/#party-usage[^}]*background:transparent/);assert.match(css,/flex-wrap:wrap/);assert.match(css,/prefers-reduced-motion/);
  assert.match(js,/label: "累计估算"/);assert.match(js,/费用未知，不虚构金额/);assert.match(js,/!\/示例\//);
});
test('old automatic echoes are hidden without deleting stored messages',()=>{
  const party=fs.readFileSync(path.join(__dirname,'../ui/party/party.js'),'utf8');
  assert.match(party,/filter\(m=>!m\.automaticSummary\)/);
});
