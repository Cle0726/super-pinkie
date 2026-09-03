const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../ui/injections/laolao-sidebar.js'),'utf8');
const segment=source.slice(source.indexOf('  const creatingSessions='),source.indexOf('  /* ---------- 4.'));
function harness({collision=false,mode='project',privateRouter=false}={}){
  const calls=[],saved=[],navigated=[],notices=[],routes=[];
  const state={projects:{Demo:[]},projectFolders:{Demo:'/projects/demo'}};
  let counter=0,collided=false;
  const shell={context:{gateway:{setSessionKey:key=>navigated.push(key)},navigate(){}}};
  const ctx={state,stateMode:mode,currentModeAgent:()=>mode,modeForSession:k=>k.split(':')[1],MODE_AGENT:{[mode]:mode},sessionIndex:null,window:{crypto:{randomUUID:()=>String(++counter)},PinkieSessionList:{invalidate(){}},location:{href:`http://127.0.0.1:18789/chat?session=agent:${mode}:main`},history:{state:{},pushState(_s,_t,url){routes.push(url)}},dispatchEvent(event){routes.push(event.type)}},URL,PopStateEvent:class{constructor(type){this.type=type}},document:{querySelector:()=>privateRouter?{}:shell},schedule(){},writeModeState:(m,s)=>saved.push([m,JSON.parse(JSON.stringify(s))]),toast:s=>notices.push(s),gwRequest:async(method,params)=>{
    calls.push({method,params});
    if(method==='sessions.list')return {sessions:[{label:'Demo · 新会话'}]};
    if(method==='sessions.create'){if(collision&&!collided){collided=true;throw Error('label already in use: Demo · 新会话 2');}return {key:params.key};}
    return {binding:{root:'/projects/demo'}};
  }};
  vm.createContext(ctx);vm.runInContext(segment,ctx);return{ctx,calls,saved,navigated,notices,routes};
}
test('project + can create multiple unique sessions, serial clicks are not label collisions',async()=>{
  const f=harness();await f.ctx.createProjectSession('Demo');await f.ctx.createProjectSession('Demo');
  const created=f.calls.filter(c=>c.method==='sessions.create');assert.equal(created.length,2);assert.notEqual(created[0].params.key,created[1].params.key);
  assert.equal(f.ctx.state.projects.Demo.length,2);assert.equal(f.navigated.length,2);
  assert.ok(f.calls.findIndex(c=>c.method==='pinkie.project.validate')<f.calls.findIndex(c=>c.method==='sessions.create'));
});
test('same-mode session navigation never reloads the document',()=>{
  const f=harness({mode:'project',privateRouter:true});
  f.ctx.navigateSession('agent:project:another');
  assert.deepEqual(f.routes,['/chat?session=agent%3Aproject%3Aanother','popstate']);
  f.ctx.window.location.href='http://127.0.0.1:18789/chat?session=agent%3Aproject%3Aanother';
  f.ctx.navigateSession('agent:project:another');
  assert.equal(f.routes.length,2,'clicking the active session is a no-op');
  assert.doesNotMatch(source,/window\.location\.assign\('\/chat'\+search\)/);
});
test('double-click is coalesced; server label race retries the same client key',async()=>{
  const f=harness({collision:true});await Promise.all([f.ctx.createProjectSession('Demo'),f.ctx.createProjectSession('Demo')]);
  const created=f.calls.filter(c=>c.method==='sessions.create');assert.equal(created.length,2);assert.equal(created[0].params.key,created[1].params.key);
  assert.equal(created[0].params.label,'Demo · 新会话 2');assert.equal(created[1].params.label,'Demo · 新会话 3');assert.equal(f.ctx.state.projects.Demo.length,1);
});
test('all four modes create sessions with their own namespace; plain chat does not acquire a folder',async()=>{
  for(const mode of ['main','project','thinking','unrestricted']){
    const f=harness({mode});await f.ctx.createProjectSession(null);
    assert.ok(f.calls.find(c=>c.method==='sessions.create').params.key.startsWith(`agent:${mode}:`));
    assert.equal(f.calls.some(c=>c.method==='pinkie.project.bind'),false);
  }
});
test('session sidebar uses independent DOM and only queries the current agent',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../ui/injections/laolao-session-list.js'),'utf8');
  assert.match(src,/agentId:api\.agentId,archived:archiveView/);
  assert.match(src,/s\.key\?\.startsWith\('agent:'\+api\.agentId\+':'\)/);
  assert.match(src,/archived:false/);assert.doesNotMatch(src,/sessions\.delete|deleteTranscript/);
  assert.match(src,/管理已归档会话/);assert.match(src,/sessionMenu\(e\.currentTarget,s\.key,title\(s\),true\)/);
  assert.match(src,/entry\.stale=true/);assert.doesNotMatch(src,/cache\.clear\(\)/);
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
  assert.match(list,/全部删除/);
  assert.match(source,/askDeleteAllSessions/);
  assert.match(source,/patchSession,askDeleteAllSessions,toast/);
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
  const ctx={state,stateMode:'project',requestNativeFolder:async()=>({path:'/tmp/project',name:'Demo'}),gwRequest:async()=>({path:'/private/tmp/project'}),uniqueProjectName:x=>x,toast(){},save(){},schedule(){}};
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
