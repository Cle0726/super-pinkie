const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
for(const file of ['ui/injections/laolao-workbench.js','services/cle-studio/static/legacy/laolao-workbench.js']) {
  const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  const method=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
  const close=method('  function closeTab(path, force) {','  function renderTabs() {');
  test(file+': pending, preview and page tabs close safely before Monaco exists',()=>{
    const tabs=[{path:'a.c',kind:'pending'},{path:'b.png',kind:'image'},{path:'page:settings',kind:'page'}],disposed=[];
    const ctx={state:{tabs,active:'a.c'},editor:null,diffEditor:null,disposeTab:t=>disposed.push(t.path),persistTabs(){},renderTabs(){},renderCrumbs(){},renderWelcome(){}};
    vm.runInNewContext(close+';closeAllTabs(true)',ctx);
    assert.deepEqual(disposed,['a.c','b.png','page:settings']);assert.equal(ctx.state.tabs.length,0);
  });
  test(file+': an attached text model is still detached before disposal',()=>{
    const model={},events=[],ctx={state:{tabs:[{path:'a.c',model,kind:'text'},{path:'b.png',kind:'image'}],active:'a.c'},editor:{getModel:()=>model,setModel:value=>events.push(value===null?'detach':'attach')},diffEditor:null,disposeTab:t=>events.push('dispose:'+t.path),persistTabs(){},renderTabs(){},renderCrumbs(){},renderWelcome(){}};
    vm.runInNewContext(close+';closeAllTabs(true)',ctx);assert.deepEqual(events,['detach','dispose:a.c','dispose:b.png']);
  });
  test(file+': the send context can change roots with unloaded tabs and no editor',async()=>{
    const key='agent:learning:editor-lifecycle',calls=[],closed=[];
    const state={visible:true,key:'agent:learning:previous',root:'/previous',info:null,tabs:[{path:'a.c',kind:'pending'},{path:'b.png',kind:'image'}],active:'a.c',tree:new Map(),search:{},selected:''};
    const ctx={state,editor:null,diffEditor:null,terminalEl:null,window:{__pinkieWorkbench:{}},contextBusy:0,contextQueue:Promise.resolve(),contextSent:new Map(),terminalContext:new Map(),contextClientId:'isolated-client',sessionLoadGeneration:0,
      sessionKey:()=>key,wanted:()=>true,store:{get:(_key,fallback)=>fallback,set(){}},findTab:p=>state.tabs.find(t=>t.path===p),disposeTab:t=>closed.push(t.path),persistTabs(){},renderTabs(){},renderCrumbs(){},renderWelcome(){},renderAll(){},renderSide(){},renderStatus(){},parkTerminal(){},restoreTabs(){},refreshGit(){},loadExtensions(){},contextSoon(){},liveTerminalIds:()=>[],fileList:async()=>[],loadDir:async()=>state.tree.set('',[]),
      rpc:async(method,params)=>{calls.push({method,params});return method==='pinkie.fs.status'?{root:'/current',agentId:'learning'}:{};}};
    vm.runInNewContext(close+method('  function workbenchSnapshot(key) {','  const contextSoon =')+method('  window.__pinkieWorkbench.flushContext = async key => {','\n\n  /* ───────── 文件图标')+method('  async function switchSession(key) {','  function persistTabs() {'),ctx);
    await ctx.window.__pinkieWorkbench.flushContext(key);
    assert.deepEqual(closed,['a.c','b.png']);assert.equal(state.root,'/current');
    const published=calls.find(c=>c.method==='pinkie.workbench.context'&&c.params.forMessage);assert.ok(published);assert.equal(published.params.sessionKey,key);assert.equal(published.params.active,true);assert.equal(published.params.activeFile,null);assert.equal(published.params.root,'/current');
  });
}
