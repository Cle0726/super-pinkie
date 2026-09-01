import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import plugin,{ProjectScope} from '../services/project-scope/index.mjs';
function fixture(t,platform=process.platform){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-project-test-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const home=fs.realpathSync(temp),a=path.join(home,'project-a'),b=path.join(home,'project-b');
  for(const dir of [a,b,path.join(home,'.openclaw/skills/demo')])fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(a,'a.txt'),'project A');fs.writeFileSync(path.join(b,'b.txt'),'project B');
  const guard=new ProjectScope({home,platform});const ctx={sessionKey:'agent:project:a'};
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
test('relative reads and writes resolve in project, traversal and symlink escapes are blocked',t=>{
  const {guard,ctx,a,b}=fixture(t);
  assert.equal(guard.before({toolName:'read',params:{path:'a.txt'}},ctx).params.path,path.join(a,'a.txt'));
  assert.equal(guard.before({toolName:'write',params:{file_path:'nested/new.txt',content:'x'}},ctx).params.file_path,path.join(a,'nested/new.txt'));
  fs.symlinkSync(b,path.join(a,'escape'));
  for(const target of [path.join(b,'b.txt'),'../project-b/b.txt','escape/b.txt','escape/new.txt']){
    assert.equal(guard.before({toolName:'read',params:{path:target}},ctx).block,true);
    assert.equal(guard.before({toolName:'write',params:{path:target,content:'x'}},ctx).block,true);
  }
});
test('shared skills remain read-only; conflicting path fields cannot bypass validation',t=>{
  const {guard,ctx,a,b,home}=fixture(t);const skill=path.join(home,'.openclaw/skills/demo/SKILL.md');fs.writeFileSync(skill,'skill');
  assert.equal(guard.before({toolName:'read',params:{path:skill}},ctx).params.path,skill);
  assert.equal(guard.before({toolName:'write',params:{path:skill}},ctx).block,true);
  assert.equal(guard.before({toolName:'read',params:{path:path.join(a,'a.txt'),file_path:path.join(b,'b.txt')}},ctx).block,true);
});
test('patch destinations, delegation, elevated exec and foreign processes cannot escape',t=>{
  const {guard,ctx,a,b}=fixture(t);
  const patch='*** Begin Patch\n*** Update File: a.txt\n@@\n-project A\n+changed\n*** End Patch';
  assert.ok(guard.before({toolName:'apply_patch',params:{input:patch}},ctx).params.input.includes(a));
  assert.equal(guard.before({toolName:'apply_patch',params:{input:patch.replace('a.txt',b+'/b.txt')}},ctx).block,true);
  for(const toolName of ['sessions_spawn','sessions_send','browser','gateway','memory_search'])assert.equal(guard.before({toolName,params:{}},ctx).block,true);
  assert.equal(guard.before({toolName:'exec',params:{command:'pwd',elevated:true}},ctx).block,true);
  assert.equal(guard.before({toolName:'process',params:{action:'list'}},ctx).block,true);
  guard.after({toolName:'exec',result:{details:{sessionId:'own-process'}}},ctx);
  assert.equal(guard.before({toolName:'process',params:{action:'poll',sessionId:'own-process'}},ctx),undefined);
  guard.bind('agent:thinking:b',b,'乙');
  assert.equal(guard.before({toolName:'process',params:{action:'poll',sessionId:'own-process'}},{sessionKey:'agent:thinking:b'}).block,true);
});
test('plain chats and unrelated agents are not commandeered; prompt names the bound project',t=>{
  const {guard,ctx,a}=fixture(t);
  assert.equal(guard.before({toolName:'read',params:{path:'/x'}},{sessionKey:'agent:other:a'}),undefined);
  assert.equal(guard.before({toolName:'read',params:{path:'/x'}},{sessionKey:'agent:main:unbound'}),undefined);
  assert.ok(guard.prompt(ctx).appendSystemContext.includes(a));
});
test('missing isolation backend fails closed',t=>{
  const {guard,ctx}=fixture(t,'linux');assert.equal(guard.before({toolName:'exec',params:{command:'pwd'}},ctx).block,true);
});
test('macOS actual shell reads/writes project but cannot read or write sibling project',{skip:process.platform!=='darwin'},t=>{
  const {guard,ctx,a,b}=fixture(t);
  const run=command=>{const result=guard.before({toolName:'exec',params:{command}},ctx);assert.ok(!result.block,result.blockReason);return spawnSync('/bin/zsh',['-f','-c',result.params.command],{cwd:result.params.workdir,encoding:'utf8'});};
  const ok=run('pwd; /bin/cat a.txt; /usr/bin/touch local.txt');
  assert.equal(ok.status,0,ok.stderr);assert.ok(ok.stdout.includes(a));assert.ok(fs.existsSync(path.join(a,'local.txt')));
  const read=run('/bin/cat '+JSON.stringify(path.join(b,'b.txt')));assert.notEqual(read.status,0);assert.ok(!read.stdout.includes('project B'));
  const write=run('/usr/bin/touch '+JSON.stringify(path.join(b,'intruder.txt')));assert.notEqual(write.status,0);assert.ok(!fs.existsSync(path.join(b,'intruder.txt')));
  const walk=run('/bin/ls '+JSON.stringify(b));assert.notEqual(walk.status,0);
});
test('registration uses authenticated RPC and official execution hooks',()=>{
  const hooks=new Map(),methods=new Map();plugin.register({on:(name,fn)=>hooks.set(name,fn),registerGatewayMethod:(name,fn,opts)=>methods.set(name,opts)});
  assert.equal(methods.get('pinkie.project.bind').scope,'operator.admin');
  for(const name of ['before_prompt_build','before_tool_call','after_tool_call'])assert.ok(hooks.has(name));
});
