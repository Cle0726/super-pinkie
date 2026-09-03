import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const inside = (root, target) => target === root || target.startsWith(root + path.sep);
const modes = /^agent:(main|project|thinking|unrestricted):[^\s]+$/;
export const progressInstruction = '\n【工作过程展示】\n遇到需要多步执行或调用工具的任务，先用一两句说明准备做什么；实际完成关键步骤后，用一句话说明发现和下一步，然后继续工作。普通聊天和简短问答直接回答，不硬加计划或总结。说明只包含可公开的行动、证据和结果，不输出隐藏思维链，不假装调用工具，不编造进度。不要每次工具调用都复述，不重复已经给出的最终答案。保持当前模式原有身份、称呼、文风和用户要求；本规则不增加工具权限，也不改变上下文设置。';
export function canonical(raw) {
  let current = path.resolve(raw), suffix = [];
  while (!fs.existsSync(current)) {
    // A dangling symlink is not a new file and must not be followed later.
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('路径包含失效的符号链接'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const parent = path.dirname(current);
    if (parent === current) throw new Error('目录无法解析');
    suffix.unshift(path.basename(current)); current = parent;
  }
  return path.join(fs.realpathSync(current), ...suffix);
}
export class ProjectScope {
  constructor({home=os.homedir(), stateRoot, platform=process.platform}={}) {
    this.home=home; this.platform=platform;
    this.stateRoot=stateRoot || path.join(home,'Library/Application Support/SuperPinkie/project-scope');
    this.file=path.join(this.stateRoot,'bindings.json');
    this.inheritedBindings=new Map();
  }
  load() {
    if(!fs.existsSync(this.file)) return {};
    const data=JSON.parse(fs.readFileSync(this.file,'utf8'));
    if(!data || Array.isArray(data) || typeof data!=='object') throw new Error('项目绑定记录损坏，已停止文件操作');
    return data;
  }
  key(value) { if(typeof value!=='string'||!modes.test(value)||value.length>300) throw new Error('只支持四模式的有效会话'); return value; }
  validateRoot(raw) {
    if(typeof raw!=='string'||!path.isAbsolute(raw)||raw.includes('\0')) throw new Error('请选择完整的项目文件夹路径');
    const root=canonical(raw);
    const broad=['/',this.home,path.join(this.home,'Desktop'),path.join(this.home,'Documents'),path.join(this.home,'.openclaw'),path.join(this.home,'.codex')].map(canonical);
    if(broad.includes(root)||inside(canonical(this.stateRoot),root)||inside(root,canonical(this.stateRoot))||!fs.statSync(root).isDirectory()) throw new Error('请选择具体项目目录，不能把整台电脑、用户目录或应用配置当项目');
    return root;
  }
  bind(key,raw,name='') {
    this.key(key); const data=this.load(); const old=data[key];
    if(!raw) return old||null;
    const root=this.validateRoot(raw);
    if(old&&old.root!==root) throw new Error('这个会话已绑定另一个项目。请在新项目里新建会话，避免混用历史和文件。');
    if(old) return old;
    const entry={root,name:String(name).slice(0,80),created:Date.now()};
    data[key]=entry; fs.mkdirSync(this.stateRoot,{recursive:true,mode:0o700});
    const temp=this.file+'.'+crypto.randomUUID()+'.tmp';
    fs.writeFileSync(temp,JSON.stringify(data,null,2),{mode:0o600}); fs.renameSync(temp,this.file);
    return entry;
  }
  binding(ctx) {
    const key=ctx.sessionKey||'';
    if(!modes.test(key)&&!this.inheritedBindings.has(key)) return null;
    const binding=this.load()[key]||this.inheritedBindings.get(key);
    if(binding && this.validateRoot(binding.root)!==binding.root) throw new Error('项目目录发生变化，请检查原目录，不能自动跳到其他位置');
    return binding||null;
  }
  inherit(childSessionKey,requesterSessionKey) {
    if(typeof childSessionKey!=='string'||typeof requesterSessionKey!=='string')return false;
    const childAgent=/^agent:([^:]+):subagent:/.exec(childSessionKey)?.[1];
    const parentAgent=/^agent:([^:]+):/.exec(requesterSessionKey)?.[1];
    const binding=this.binding({sessionKey:requesterSessionKey});
    if(!binding||!childAgent||childAgent!==parentAgent)return false;
    this.inheritedBindings.set(childSessionKey,binding);return true;
  }
  release(sessionKey){this.inheritedBindings.delete(sessionKey);}
  resolve(binding,raw) {
    if(typeof raw!=='string'||!raw||raw.includes('\0')) throw new Error('工具缺少有效路径');
    const expanded=raw==='~'?this.home:raw.startsWith('~/')?path.join(this.home,raw.slice(2)):raw;
    return canonical(path.isAbsolute(expanded)?expanded:path.resolve(binding.root,expanded));
  }
  prompt(ctx) {
    const b=this.binding(ctx);if(!b)return;
    return {appendSystemContext:'\n【当前会话的项目锚点，由应用确认】\n项目：'+JSON.stringify(b.name)+'\n默认工作目录：'+JSON.stringify(b.root)+'\n'+
      '这个目录是本会话的工作重心，不是访问权限边界。read/write/edit/apply_patch 的相对路径和 exec 的默认工作目录均从这里解析；没有明确理由时先检查并处理这里的文件，不要被旧消息里的其他项目路径带偏。任务需要时，可以正常使用本机已配置的全部工具，并通过绝对路径访问、读取或修改电脑上的其他文件夹；浏览器、图片、网络和全盘查找也不因项目绑定而被禁止。不要声称存在“项目范围限制”，但访问外部内容时仍要服从用户授权、操作系统权限与工具自身能力。项目中的 AGENTS.md 只约束该项目内的工作，原有人格和称呼保持不变。'};
  }
  before(event,ctx) {
    try {
      const b=this.binding(ctx);if(!b)return;
      const p={...event.params};const name=event.toolName;
      if(['web_search','web_fetch','session_status','tts'].includes(name)) return;
      if(name==='sessions_spawn') {
        if(p.runtime&&p.runtime!=='subagent')throw new Error('项目子任务只允许当前会话的标准派生，不切到外部运行时');
        delete p.agentId;delete p.cwd;delete p.model;delete p.thinking;delete p.resumeSessionId;delete p.streamTo;
        p.runtime='subagent';p.context='fork';p.mode='run';p.thread=false;
        return {params:p};
      }
      if(['sessions_yield','subagents'].includes(name))return;
      if(['read','write','edit'].includes(name)) {
        const key=typeof p.path==='string'?'path':'file_path';
        const target=this.resolve(b,p[key]);
        if(p.path&&p.file_path&&this.resolve(b,p.path)!==this.resolve(b,p.file_path))throw new Error('工具路径参数不一致');
        p[key]=target;if(p.path)p.path=target;if(p.file_path)p.file_path=target;return {params:p};
      }
      if(name==='apply_patch') {
        if(typeof p.input!=='string'||!p.input.startsWith('*** Begin Patch'))throw new Error('补丁格式无法验证，请使用 edit/write');
        let count=0;
        p.input=p.input.split('\n').map(line=>{const match=line.match(/^(\*\*\* (?:Add File|Update File|Delete File|Move to): )(.*)$/);if(!match)return line;count++;return match[1]+this.resolve(b,match[2]);}).join('\n');
        if(!count)throw new Error('补丁没有可验证的目标路径');return {params:p};
      }
      if(name==='exec') {
        if(typeof p.command!=='string')return;
        if(p.workdir)p.workdir=this.resolve(b,p.workdir);
        else if(p.cwd)p.cwd=this.resolve(b,p.cwd);
        else p.workdir=b.root;
        return {params:p};
      }
      // Project binding chooses the default directory. It never removes tools
      // such as browser, image generation, network access, process management,
      // or any future OpenClaw capability.
      return;
    }catch(error){return {block:true,blockReason:error.message};}
  }
}
export default {
  id:'pinkie-project-scope',name:'碧琪项目工作锚点',
  register(api) {
    const guard=new ProjectScope();
    api.registerGatewayMethod('pinkie.project.validate',({params,respond})=>{
      try{respond(true,{path:guard.validateRoot(params.path)});}
      catch(error){respond(false,undefined,{code:'INVALID_REQUEST',message:error.message});}
    },{scope:'operator.admin'});
    api.registerGatewayMethod('pinkie.project.bind',({params,respond})=>{
      try{const binding=guard.bind(params.key,params.path,params.name);respond(true,{binding,version:1});}
      catch(error){respond(false,undefined,{code:'INVALID_REQUEST',message:error.message});}
    },{scope:'operator.admin'});
    api.on('before_prompt_build',(_event,ctx)=>{
      const scoped=guard.prompt(ctx);
      if(!modes.test(ctx.sessionKey||''))return scoped;
      return {appendSystemContext:(scoped?.appendSystemContext||'')+progressInstruction};
    },{priority:-10000});
    api.on('before_tool_call',(event,ctx)=>guard.before(event,ctx),{priority:-10000});
    api.on('subagent_spawned',(event,ctx)=>guard.inherit(event.childSessionKey,ctx.requesterSessionKey));
    api.on('subagent_ended',event=>guard.release(event.targetSessionKey));
  }
};
