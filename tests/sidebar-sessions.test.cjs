const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../ui/injections/laolao-sidebar.js'),'utf8');
const segment=source.slice(source.indexOf('  const creatingSessions='),source.indexOf('  /* ---------- 4.'));
function harness({collision=false,mode='project',privateRouter=false,splitDrawer=false,drawerOpen=splitDrawer}={}){
  const calls=[],saved=[],navigated=[],notices=[],routes=[],syncEvents=[];
  const state={projects:{Demo:[]},projectFolders:{Demo:'/projects/demo'}};
  let counter=0,collided=false;
  let drawerCloses=0;
  const drawer={querySelector:()=>({disabled:false,click(){drawerCloses++;}})};
  const shell={navDrawerOpen:drawerOpen,closeNavDrawer(){if(this.navDrawerOpen){drawerCloses++;this.navDrawerOpen=false;}},navigate(_route,{search}){routes.push('native:'+search);},context:{gateway:{setSessionKey:key=>navigated.push(key)},navigate(){}}};
  const ctx={state,stateMode:mode,currentModeAgent:()=>mode,modeForSession:k=>k.split(':')[1],MODE_AGENT:{[mode]:mode},sessionIndex:null,window:{crypto:{randomUUID:()=>String(++counter)},PinkieSessionList:{invalidate(){}},location:{href:`http://127.0.0.1:18789/chat?session=agent:${mode}:main`},history:{state:{},pushState(_s,_t,url){routes.push(url)}},setTimeout(fn){fn();},dispatchEvent(event){if(event.type==='pinkie:session-selected')syncEvents.push(event.detail.sessionKey);else routes.push(event.type)}},URL,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},PopStateEvent:class{constructor(type){this.type=type}},document:{querySelector:selector=>selector==='.shell.shell--nav-drawer-open'?(drawerOpen?drawer:null):(privateRouter?{}:shell)},schedule(){},writeModeState:(m,s)=>saved.push([m,JSON.parse(JSON.stringify(s))]),toast:s=>notices.push(s),gwRequest:async(method,params)=>{
    calls.push({method,params});
    if(method==='sessions.list')return {sessions:[{label:'Demo · 新会话'}]};
    if(method==='sessions.create'){if(collision&&!collided){collided=true;throw Error('label already in use: Demo · 新会话 2');}return {key:params.key};}
    return {binding:{root:'/projects/demo'}};
  }};
  vm.createContext(ctx);vm.runInContext(segment,ctx);return{ctx,calls,saved,navigated,notices,routes,syncEvents,drawerCloses:()=>drawerCloses};
}
test('project + can create multiple unique sessions, serial clicks are not label collisions',async()=>{
  const f=harness();await f.ctx.createProjectSession('Demo');await f.ctx.createProjectSession('Demo');
  const created=f.calls.filter(c=>c.method==='sessions.create');assert.equal(created.length,2);assert.notEqual(created[0].params.key,created[1].params.key);
  assert.equal(f.ctx.state.projects.Demo.length,2);assert.equal(f.navigated.length,0);
  assert.ok(f.calls.findIndex(c=>c.method==='pinkie.project.validate')<f.calls.findIndex(c=>c.method==='sessions.create'));
});
test('same-mode session navigation never reloads the document',()=>{
  const f=harness({mode:'project',privateRouter:true});
  f.ctx.navigateSession('agent:project:another');
  assert.deepEqual(f.routes,['/chat?session=agent%3Aproject%3Aanother','popstate']);
  f.ctx.window.location.href='http://127.0.0.1:18789/chat?session=agent%3Aproject%3Aanother';
  f.ctx.navigateSession('agent:project:another');
  assert.equal(f.routes.length,2,'clicking the active session should not navigate again');
  assert.deepEqual(f.syncEvents,['agent:project:another','agent:project:another'],
    'clicking the active session must recheck its visible history');
  assert.doesNotMatch(source,/window\.location\.assign\('\/chat'\+search\)/);
});
test('switching a split session closes the stale mobile drawer before routing',()=>{
  const f=harness({mode:'project',privateRouter:true,splitDrawer:true});
  f.ctx.navigateSession('agent:project:another');
  assert.equal(f.drawerCloses(),1);
  assert.deepEqual(f.routes,['/chat?session=agent%3Aproject%3Aanother','popstate']);
});
test('single-window session navigation closes the native drawer before routing',()=>{
  const f=harness({mode:'project',drawerOpen:true});
  f.ctx.navigateSession('agent:project:another');
  assert.equal(f.drawerCloses(),1);
  assert.deepEqual(f.routes,['native:?session=agent%3Aproject%3Aanother']);
});
test('double-click is coalesced; server label race retries the same client key',async()=>{
  const f=harness({collision:true});await Promise.all([f.ctx.createProjectSession('Demo'),f.ctx.createProjectSession('Demo')]);
  const created=f.calls.filter(c=>c.method==='sessions.create');assert.equal(created.length,2);assert.equal(created[0].params.key,created[1].params.key);
  assert.equal(created[0].params.label,'Demo · 新会话 2');assert.equal(created[1].params.label,'Demo · 新会话 3');assert.equal(f.ctx.state.projects.Demo.length,1);
});
test('all four modes create sessions with their own namespace; plain chat does not acquire a folder',async()=>{
  for(const mode of ['main','project','thinking','learning']){
    const f=harness({mode});await f.ctx.createProjectSession(null);
    assert.ok(f.calls.find(c=>c.method==='sessions.create').params.key.startsWith(`agent:${mode}:`));
    assert.equal(f.calls.some(c=>c.method==='pinkie.project.bind'),false);
  }
});
test('session sidebar uses independent DOM and only queries the current agent',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../ui/injections/laolao-session-list.js'),'utf8');
  assert.match(src,/agentId: api\.agentId, archived, includeLastMessage: true/);
  assert.match(src,/s\.key\?\.startsWith\('agent:' \+ api\.agentId \+ ':'\)/);
  assert.doesNotMatch(src,/sessions\.delete|deleteTranscript/);
  assert.match(src,/管理已归档会话/);
  assert.match(src,/pinkie\.session\.title\.ensure/);
  assert.match(src,/pinkie\.session\.title\.metadata/);
  assert.doesNotMatch(source,/autoTitleFromText|drainAutoTitleHistory|queueAutoTitles/);
  assert.match(source,/gwRequest\('pinkie\.session\.rename', \{key, title: name\}\)/);
});
test('derived worker sessions stay out of every user-facing sidebar path',()=>{
  assert.match(source,/!s\.key\.includes\(":subagent:"\)/);
  const css=fs.readFileSync(path.join(__dirname,'../ui/injections/laolao-sidebar.css'),'utf8');
  assert.match(css,/data-session-key\*=":subagent:"/);
});
test('single-session menu supports safe archive, restore and permanent deletion',()=>{
  assert.match(source,/sessions\.delete/);
  assert.match(source,/deleteTranscript:true/);
  assert.match(source,/askDeleteSession/);
  assert.match(source,/followAfterSessionLeaves/);
  assert.match(source,/项目文件夹里的真实文件不会被动/);
  assert.match(source,/busyText:'删除中…'/);
});
test('session manager exposes one confirmed bulk delete for the current mode',()=>{
  const list=fs.readFileSync(path.join(__dirname,'../ui/injections/laolao-session-list.js'),'utf8');
  assert.match(list,/openRecentMenu/);
  assert.match(source,/已归档的会话/);
  assert.match(source,/打开文件夹建项目/);
  assert.match(source,/删除当前模式全部会话/);
  assert.match(source,/askDeleteAllSessions/);
  assert.match(source,/patchSession,askDeleteAllSessions,openSessionManagement,openRecentMenu,archiveMany/);
  assert.match(source,/archived:true/);
  assert.match(source,/targets\.slice\(offset, offset \+ 5\)/);
  assert.match(source,/项目文件夹里的真实文件不会被动/);
});
test('managed sessions scroll inside the sidebar instead of covering its footer',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../ui/injections/laolao-sidebar.css'),'utf8');
  assert.match(css,/\.laolao-managed-sessions\{overflow:hidden!important\}/);
  assert.match(css,/#laolao-session-manager\{[^}]*min-height:0;[^}]*flex:1 1 auto;[^}]*overflow-y:auto/);
});
test('folder project stores validated canonical path and returns the existing project on duplicate',async()=>{
  const state={projects:{},projectFolders:{},collapsed:{}};
  const ctx={state,stateMode:'project',pageSessionKey:()=>"agent:project:main",requestNativeFolder:async()=>({path:'/tmp/project',name:'Demo'}),gwRequest:async()=>({path:'/private/tmp/project'}),uniqueProjectName:x=>x,toast(){},save(){},schedule(){}};
  vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  async function addFolderProject('),source.indexOf('  async function copyProjectPath(')),ctx);
  assert.equal(await ctx.addFolderProject(),'Demo');assert.equal(state.projectFolders.Demo,'/private/tmp/project');
  assert.equal(await ctx.addFolderProject(),'Demo');assert.equal(Object.keys(state.projects).length,1);
});
test('assign-menu new project chooses a validated folder rather than creating a broken empty group',()=>{
  const menu=source.slice(source.indexOf('  function openProjectMenu('),source.indexOf('  async function assignToProject('));
  assert.match(menu,/await addFolderProject\(\)/);assert.match(menu,/stateMode===ownerMode/);
  assert.doesNotMatch(menu,/state\.projects\[name\] = \[\]/);
  assert.match(menu,/if\(name!==current\)assignToProject/);
});
test('new session shortcut leaves workbench and Monaco keyboard handling alone',()=>{
  const snippet=source.slice(source.indexOf('  function isNewSessionShortcut('),source.indexOf("  document.addEventListener('keydown',event=>{\n    if(!isNewSessionShortcut"));
  const ctx={};vm.createContext(ctx);vm.runInContext(snippet,ctx);
  const event={key:'n',metaKey:true,target:{closest:()=>null}};
  assert.equal(ctx.isNewSessionShortcut(event),true);
  assert.equal(ctx.isNewSessionShortcut({...event,target:{closest:()=>({})}}),false);
  assert.equal(ctx.isNewSessionShortcut({...event,shiftKey:true}),false);
  assert.equal(ctx.isNewSessionShortcut({...event,defaultPrevented:true}),false);
});
test('connection status reports slow only after 800 ms and offline wins',()=>{
  const snippet=source.slice(source.indexOf('  function connectionState('),source.indexOf('  function paletteProjectMatch('));
  const ctx={};vm.createContext(ctx);vm.runInContext(snippet,ctx);
  assert.equal(ctx.connectionState(true,800),'online');
  assert.equal(ctx.connectionState(true,801),'slow');
  assert.equal(ctx.connectionState(false,100),'offline');
  assert.equal(ctx.connectionState(true,null),'online');
});
test('sidebar tooltip fits inside the viewport near its right and bottom edges',()=>{
  const snippet=source.slice(source.indexOf('  function tooltipPosition('),source.indexOf('  let sidebarTooltip=')).replace(/\n\s*$/,'');
  const ctx={};vm.createContext(ctx);vm.runInContext(snippet,ctx);
  const pos=ctx.tooltipPosition({left:195,top:180,bottom:200},{width:100,height:40},{width:220,height:220});
  assert.deepEqual(JSON.parse(JSON.stringify(pos)),{left:112,top:134});
});
test('command palette recognises project creation searches',()=>{
  const snippet=source.slice(source.indexOf('  function paletteProjectMatch('),source.indexOf('  function ensurePaletteCommands('));
  const ctx={};vm.createContext(ctx);vm.runInContext(snippet,ctx);
  assert.equal(ctx.paletteProjectMatch('新建项目'),true);
  assert.equal(ctx.paletteProjectMatch('folder'),true);
  assert.equal(ctx.paletteProjectMatch('天气'),false);
});
test('command palette keeps session search inside the current mode and ignores stale replies',async()=>{
  const snippet=source.slice(source.indexOf('  function paletteProjectMatch('),source.indexOf('  function tooltipPosition('));
  const palette={open:true,sessionSearchId:0,onNavigate(){}},requests=[],created=[];
  let finish;
  const ctx={document:{querySelector:()=>palette},stateMode:'chat',currentModeAgent:()=>ctx.stateMode==='chat'?'main':'project',
    gwRequest:(method,params)=>{requests.push({method,params});return new Promise(resolve=>finish=resolve);},
    addFolderProject:(...args)=>created.push(args)};
  vm.createContext(ctx);vm.runInContext(snippet,ctx);ctx.ensurePaletteCommands();
  const first=palette.searchSessions('项目');
  finish({ok:true,results:[{key:'agent:main:one',title:'本模式'},{key:'agent:project:two',title:'其他模式'}]});
  await first;
  assert.deepEqual(Array.from(palette.sessionItems,item=>item.action),['session:agent:main:one','nav:pinkie-new-project']);
  assert.equal(requests[0].params.agentId,'main');assert.equal(requests[0].params.mode,'chat');
  palette.onNavigate('pinkie-new-project');assert.equal(created.length,1);
  const stale=palette.searchSessions('旧查询');ctx.stateMode='project';finish({ok:true,results:[{key:'agent:main:old'}]});await stale;
  assert.equal(palette.sessionItems.some(item=>item.action==='session:agent:main:old'),false);
});
test('archive checks running children and respects cancellation before changing the parent',async()=>{
  const snippet=source.slice(source.indexOf('  async function archiveSession('),source.indexOf('  function showArchiveUndo('));
  const calls=[];let choice='cancel',stopResult={ok:true,stopped:1,cancelled:1};
  const ctx={MODE_AGENT:{chat:'main'},stateMode:'chat',modeForSession:()=> 'chat',window:{},schedule(){},
    gwRequest:async(method,params)=>{calls.push([method,params]);return method==='pinkie.session.lineage'
      ? {states:{'agent:main:parent':{runningChildren:2}}} : stopResult;},
    archiveChildChoice:async count=>{calls.push(['choice',count]);return choice;},
    patchSession:async(...args)=>calls.push(['patch',...args]),followAfterSessionLeaves:async()=>{},toast(){}};
  vm.createContext(ctx);vm.runInContext(snippet,ctx);
  assert.equal(await ctx.archiveSession('agent:main:parent'),false);
  assert.equal(calls.some(call=>call[0]==='patch'),false);
  choice='parent';assert.equal(await ctx.archiveSession('agent:main:parent'),true);
  assert.equal(calls.filter(call=>call[0]==='patch').length,1);
  choice='stop';assert.equal(await ctx.archiveSession('agent:main:parent'),true);
  assert.equal(calls.filter(call=>call[0]==='patch').length,1);
  assert.deepEqual(calls.filter(call=>call[0]==='pinkie.session.archive.stopChildren').map(call=>call[1].key),['agent:main:parent']);
  stopResult={ok:false,error:'父会话还在运行'};
  await assert.rejects(ctx.archiveSession('agent:main:parent'),/父会话还在运行/);
  assert.equal(calls.filter(call=>call[0]==='patch').length,1);
});
