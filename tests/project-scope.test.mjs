import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import plugin,{ProjectScope} from '../services/project-scope/index.mjs';

function fixture(t){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-project-test-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const home=fs.realpathSync(temp),a=path.join(home,'project-a'),b=path.join(home,'project-b');
  for(const dir of [a,b,path.join(home,'.openclaw/skills/demo')])fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(a,'a.txt'),'project A');fs.writeFileSync(path.join(b,'b.txt'),'project B');
  const guard=new ProjectScope({home});const ctx={sessionKey:'agent:project:a'};
  guard.bind(ctx.sessionKey,a,'甲');return {guard,ctx,a,b,home};
}

test('bindings are independent for all four modes, persisted, immutable and reject broad roots',t=>{
  const {guard,a,b,home}=fixture(t);
  for(const mode of ['main','project','thinking','unrestricted'])assert.equal(guard.bind('agent:'+mode+':one',a,mode).root,a);
  assert.equal(new ProjectScope({home}).bind('agent:project:a',null).root,a);
  assert.throws(()=>guard.bind('agent:project:a',b),/新建会话/);
  assert.throws(()=>guard.bind('agent:project:root',home),/具体项目/);
  assert.throws(()=>guard.bind('agent:other:a',a),/四模式/);
});

test('relative paths use the project while absolute and symlinked paths may reach the computer',t=>{
  const {guard,ctx,a,b}=fixture(t);
  assert.equal(guard.before({toolName:'read',params:{path:'a.txt'}},ctx).params.path,path.join(a,'a.txt'));
  assert.equal(guard.before({toolName:'write',params:{file_path:'nested/new.txt',content:'x'}},ctx).params.file_path,path.join(a,'nested/new.txt'));
  assert.equal(guard.before({toolName:'read',params:{path:path.join(b,'b.txt')}},ctx).params.path,path.join(b,'b.txt'));
  assert.equal(guard.before({toolName:'write',params:{path:path.join(b,'new.txt'),content:'x'}},ctx).params.path,path.join(b,'new.txt'));
  fs.symlinkSync(b,path.join(a,'external'));
  assert.equal(guard.before({toolName:'read',params:{path:'external/b.txt'}},ctx).params.path,path.join(b,'b.txt'));
});

test('all configured tools pass through and exec only receives a default project directory',t=>{
  const {guard,ctx,a,b}=fixture(t);
  for(const toolName of ['browser','gateway','memory_search','image_generate','process','sessions_send']){
    assert.equal(guard.before({toolName,params:{sample:true}},ctx),undefined);
  }
  const anchored=guard.before({toolName:'exec',params:{command:'pwd'}},ctx).params;
  assert.equal(anchored.command,'pwd');assert.equal(anchored.workdir,a);
  const external=guard.before({toolName:'exec',params:{command:'pwd',workdir:b,elevated:true,host:'node'}},ctx).params;
  assert.equal(external.workdir,b);assert.equal(external.elevated,true);assert.equal(external.host,'node');
});

test('patches may target project-relative or computer-absolute files',t=>{
  const {guard,ctx,a,b}=fixture(t);
  const relative='*** Begin Patch\n*** Update File: a.txt\n@@\n-project A\n+changed\n*** End Patch';
  assert.ok(guard.before({toolName:'apply_patch',params:{input:relative}},ctx).params.input.includes(path.join(a,'a.txt')));
  const absolute=relative.replace('a.txt',path.join(b,'b.txt'));
  assert.ok(guard.before({toolName:'apply_patch',params:{input:absolute}},ctx).params.input.includes(path.join(b,'b.txt')));
});

test('delegation stays a standard child of the current session and inherits its project anchor',t=>{
  const {guard,ctx,a,b}=fixture(t);
  const derived=guard.before({toolName:'sessions_spawn',params:{task:'check',label:'批评者',agentId:'other',cwd:b,model:'other/model'}},ctx);
  assert.equal(derived.params.context,'fork');assert.equal(derived.params.runtime,'subagent');assert.equal(derived.params.label,'批评者');
  for(const key of ['agentId','cwd','model'])assert.equal(key in derived.params,false);
  const child='agent:project:subagent:child-1';
  assert.equal(guard.inherit(child,ctx.sessionKey),true);
  assert.equal(guard.before({toolName:'read',params:{path:'a.txt'}},{sessionKey:child}).params.path,path.join(a,'a.txt'));
  assert.equal(guard.before({toolName:'read',params:{path:path.join(b,'b.txt')}},{sessionKey:child}).params.path,path.join(b,'b.txt'));
  guard.release(child);
  assert.equal(guard.before({toolName:'read',params:{path:'/elsewhere'}},{sessionKey:child}),undefined);
  assert.equal(guard.inherit('agent:thinking:subagent:bad',ctx.sessionKey),false);
});

test('plain chats are untouched and the prompt describes a project anchor, not a sandbox',t=>{
  const {guard,ctx,a}=fixture(t);
  assert.equal(guard.before({toolName:'read',params:{path:'/x'}},{sessionKey:'agent:other:a'}),undefined);
  assert.equal(guard.before({toolName:'read',params:{path:'/x'}},{sessionKey:'agent:main:unbound'}),undefined);
  const prompt=guard.prompt(ctx).appendSystemContext;
  assert.ok(prompt.includes(a));assert.match(prompt,/工作重心/);assert.match(prompt,/不是访问权限边界/);assert.match(prompt,/浏览器/);
});

test('real commands start in the project and can access a sibling folder',t=>{
  const {guard,ctx,a,b}=fixture(t);
  const run=guard.before({toolName:'exec',params:{command:'/bin/cat '+JSON.stringify(path.join(b,'b.txt'))}},ctx).params;
  const result=spawnSync('/bin/sh',['-c',run.command],{cwd:run.workdir,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'project B');assert.equal(run.workdir,a);
});

test('registration uses authenticated RPC and official project-anchor hooks',()=>{
  const hooks=new Map(),methods=new Map();plugin.register({on:(name,fn)=>hooks.set(name,fn),registerGatewayMethod:(name,fn,opts)=>methods.set(name,opts)});
  assert.equal(methods.get('pinkie.project.bind').scope,'operator.admin');
  for(const name of ['before_prompt_build','before_tool_call','subagent_spawned','subagent_ended'])assert.ok(hooks.has(name));
  assert.equal(hooks.has('after_tool_call'),false);
});
