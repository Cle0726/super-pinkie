import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
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
    this.processes=new Map();
    this.skillRoots=['.openclaw/skills','.agents/skills','.codex/skills',...['workspace','workspace-project','workspace-thinking','workspace-unrestricted'].map(p=>'.openclaw/'+p+'/skills')].map(p=>canonical(path.join(home,p)));
    this.skillRoots.push(canonical(path.resolve(path.dirname(process.execPath),'../lib/node_modules/openclaw/skills')));
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
    if(!modes.test(ctx.sessionKey||'')) return null;
    const binding=this.load()[ctx.sessionKey];
    if(binding && this.validateRoot(binding.root)!==binding.root) throw new Error('项目目录发生变化，请检查原目录，不能自动跳到其他位置');
    return binding||null;
  }
  resolve(binding,raw,read=false) {
    if(typeof raw!=='string'||!raw||raw.includes('\0')) throw new Error('工具缺少有效路径');
    const expanded=raw==='~'?this.home:raw.startsWith('~/')?path.join(this.home,raw.slice(2)):raw;
    const target=canonical(path.resolve(binding.root,expanded));
    if(inside(binding.root,target)||(read&&this.skillRoots.some(root=>inside(root,target)))) return target;
    throw new Error('已拦截跨项目访问。当前项目：'+binding.root+'；请求路径：'+target);
  }
  sandbox(binding,key) {
    if(this.platform!=='darwin'||!fs.existsSync('/usr/bin/sandbox-exec')) throw new Error('当前系统尚无项目命令隔离器，已停止执行；不会退回无限制终端');
    const temp=path.join(this.stateRoot,'tmp',crypto.createHash('sha256').update(key).digest('hex').slice(0,24));
    fs.mkdirSync(temp,{recursive:true,mode:0o700});
    const runtime=path.resolve(path.dirname(process.execPath),'..');
    const reads=[binding.root,temp,...this.skillRoots,runtime,'/System','/usr','/bin','/sbin','/Library','/dev','/private/etc','/opt/homebrew'].filter(p=>fs.existsSync(p)).map(canonical);
    const sub=p=>'(subpath '+JSON.stringify(p)+')';
    const profile='(version 1)(allow default)(deny file-read-data)(deny file-write*)'+
      '(allow file-read-data (literal "/") '+reads.map(sub).join(' ')+')'+
      '(allow file-write* '+[binding.root,temp,'/dev/null','/dev/tty'].map(sub).join(' ')+')'+
      '(deny network-outbound (remote ip "localhost:*"))';
    return {profile,temp};
  }
  prompt(ctx) {
    const b=this.binding(ctx);if(!b)return;
    return {appendSystemContext:'\n【当前会话的项目范围，由应用确认】\n项目：'+JSON.stringify(b.name)+'\n实际工作目录：'+JSON.stringify(b.root)+'\n'+
      '本会话只管理这个项目。read/write/edit 的相对路径和 exec 默认工作目录均由应用解析到这里。不要依据旧消息里的目录去找其他项目，也不要把人格所在目录当项目目录。先检查本项目现有文件，再解释或修改；缺少文件就直接说明，不能全盘搜索。跨项目操作会被拦截；需要换项目时请用户在目标项目中新建会话。每轮使用 Skill 前重新读取所需 SKILL.md；只读的共享 skill 不属于项目文件。遵循本项目中的 AGENTS.md，但不能扩大这里的文件范围。原有人格和称呼保持不变。'};
  }
  before(event,ctx) {
    try {
      const b=this.binding(ctx);if(!b)return;
      const p={...event.params};const name=event.toolName;
      if(['web_search','web_fetch','session_status','tts'].includes(name)) return;
      if(['read','write','edit'].includes(name)) {
        const key=typeof p.path==='string'?'path':'file_path';
        const target=this.resolve(b,p[key],name==='read');
        if(p.path&&p.file_path&&this.resolve(b,p.path,name==='read')!==this.resolve(b,p.file_path,name==='read'))throw new Error('工具路径参数不一致');
        p[key]=target;if(p.path)p.path=target;if(p.file_path)p.file_path=target;return {params:p};
      }
      if(name==='apply_patch') {
        if(typeof p.input!=='string'||!p.input.startsWith('*** Begin Patch'))throw new Error('补丁格式无法验证，请使用 edit/write');
        let count=0;
        p.input=p.input.split('\n').map(line=>{const match=line.match(/^(\*\*\* (?:Add File|Update File|Delete File|Move to): )(.*)$/);if(!match)return line;count++;return match[1]+this.resolve(b,match[2]);}).join('\n');
        if(!count)throw new Error('补丁没有可验证的目标路径');return {params:p};
      }
      if(name==='exec'&&!event.toolKind&&!ctx.toolKind) {
        if(typeof p.command!=='string')throw new Error('当前项目只接受可约束的 shell 命令');
        if(p.elevated||p.node||p.host&&p.host!=='gateway')throw new Error('项目任务不能切换到其他主机或提权执行');
        const cwd=p.workdir?this.resolve(b,p.workdir):b.root;
        const {profile,temp}=this.sandbox(b,ctx.sessionKey);
        p.command='/usr/bin/sandbox-exec -p '+quote(profile)+' /usr/bin/env TMPDIR='+quote(temp)+' GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 /bin/zsh -f -c '+quote(p.command);
        p.workdir=cwd;p.host='gateway';p.elevated=false;return {params:p};
      }
      if(name==='process') {
        if(!p.sessionId||this.processes.get(p.sessionId)!==ctx.sessionKey) throw new Error('只能管理当前项目会话启动的进程，不能读取其他会话的进程');
        return;
      }
      throw new Error('工具“'+name+'”尚未接入项目范围约束，已阻止绕过目录。请使用 read/write/edit/apply_patch/exec 管理本项目。');
    }catch(error){return {block:true,blockReason:error.message};}
  }
  after(event,ctx) {
    if(event.toolName==='exec'&&event.result?.details?.sessionId&&this.binding(ctx))this.processes.set(event.result.details.sessionId,ctx.sessionKey);
  }
}
export default {
  id:'pinkie-project-scope',name:'碧琪项目目录约束',
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
    api.on('after_tool_call',(event,ctx)=>guard.after(event,ctx));
  }
};
