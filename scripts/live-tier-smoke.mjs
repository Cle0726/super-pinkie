/** Opt-in paid integration test. Every scenario owns a new session and temp project. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const exec = promisify(execFile);
const argv = process.argv.slice(2);
const option = name => argv[argv.indexOf(name) + 1];
if (!argv.includes('--run') || !argv.includes('--model')) {
  throw new Error('Paid test requires explicit --run --model provider/model. Optional --tiers base,boost,full,marathon');
}
const model = option('--model');
const tiers = argv.includes('--tiers') ? option('--tiers').split(',') : ['base','boost','full','marathon'];
if (tiers.some(tier => !['base','boost','full','marathon'].includes(tier))) throw new Error('Unknown tier');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cle-kk-release-live-'));
const cli = process.env.PINKIE_OPENCLAW_BIN || 'openclaw';
const parseJson = stdout => {
  const text = String(stdout).trim();
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf('{');
  if (start >= 0) return JSON.parse(text.slice(start));
  throw new Error(`No JSON response: ${text.slice(-500)}`);
};
async function rpc(method, params) {
  const {stdout} = await exec(cli,['gateway','call',method,'--params',JSON.stringify(params),'--json','--timeout','20000'],{timeout:30_000,maxBuffer:8*1024*1024});
  return parseJson(stdout);
}
const agents = {base:'unrestricted',boost:'project',full:'thinking',marathon:'main'};
const results = [];
console.log(JSON.stringify({root,model,tiers}));
async function scenario(tier) {
  const directory = path.join(root,tier);
  fs.mkdirSync(directory);
  const id = `cle-kk-release-${tier}-${randomUUID().slice(0,8)}`;
  const agentId = agents[tier], sessionKey = `agent:${agentId}:${id}`;
  const target = path.join(directory,'result.txt'), expected = `CLE_KK_${tier.toUpperCase()}_VERIFIED`;
  const skill = path.join(directory,'skills','delivery-check','SKILL.md');
  const verifier = path.join(directory,'skills','delivery-check','tools','verify_completion.py');
  fs.mkdirSync(path.dirname(verifier),{recursive:true});
  fs.writeFileSync(skill,`# Delivery check\nRead this Skill fully. Write ${JSON.stringify(expected)} (optional trailing newline) to ${target} using the real write tool. Independently read it. Only the parent writes this output. Never modify this Skill or tools/verify_completion.py. At the end use delivery_guard verify and provide the concise actual result. Other tier roles inspect or assess the exact task, without unrelated projects.\n`);
  fs.writeFileSync(verifier,`import json, pathlib, sys\np=pathlib.Path(${JSON.stringify(target)})\nok=p.is_file() and p.read_text().strip()==${JSON.stringify(expected)}\nprint(json.dumps({'status':'PASS' if ok else 'FAIL','verified':ok,'issues':[] if ok else ['Target content mismatch or missing']}))\nsys.exit(0 if ok else 1)\n`);
  const prompt = `这是授权的真实档位回归。请用当前已选档位完成执行任务：先完整读取 ${skill}，按 Skill 真正创建 ${target}，内容必须是 ${expected}。所有操作仅使用这个临时项目。保持所选模型 ${model}；按档位真实派生并收齐规划/求解/批评/升级/仲裁，角色发言简洁有具体依据（各约80字，内容各自独立），主代理负责写入与独立read核对，最后调用delivery_guard verify。不要只给报告或计划，不修改其他工作区/任何设置/Skill/验证器。任务就这一件，完成且验收通过后正常结束（长跑档附内部完成标记）。最终仅两句话说明实际成品和验证结果。`;
  fs.writeFileSync(path.join(directory,'case.json'),JSON.stringify({sessionKey,agentId,tier,model,target,expected,skill},null,2));
  let passed=false;
  try {
    const armed = await rpc('pinkie.deepThink.arm',{sessionKey,tier});
    if (!armed.armed) throw new Error('Tier not armed');
    console.log(JSON.stringify({tier,stage:'started',sessionKey}));
    const initial = exec(cli,['agent','--agent',agentId,'--session-key',sessionKey,'--model',model,'--thinking','high','--timeout','900','--json','--message',prompt],{timeout:930_000,maxBuffer:16*1024*1024})
      .then(({stdout,stderr})=>{fs.writeFileSync(path.join(directory,'initial.json'),stdout);if(stderr)fs.writeFileSync(path.join(directory,'initial.stderr'),stderr);return true;})
      .catch(error=>{fs.writeFileSync(path.join(directory,'initial-error.txt'),String(error.stderr||error.message));return false;});
    const deadline=Date.now()+30*60_000;
    let last='', finalStatus;
    while(Date.now()<deadline) {
      await new Promise(resolve=>setTimeout(resolve,15_000));
      const status=await rpc('pinkie.deepThink.status',{sessionKey});
      const signature=JSON.stringify([status.phase,status.completed,status.pending,status.failedChildren,status.modelMismatches]);
      if(signature!==last) console.log(JSON.stringify({tier,stage:'progress',phase:status.phase,completed:status.completed,required:status.required,pending:status.pending,failed:status.failedChildren,model:status.expectedModel,mismatches:status.modelMismatches}));
      last=signature;
      if(!status.active){finalStatus=status;break;}
    }
    if(!finalStatus) throw new Error('Tier deadline exceeded');
    await initial;
    const history=await rpc('chat.history',{sessionKey,limit:100});
    fs.writeFileSync(path.join(directory,'history.json'),JSON.stringify(history,null,2));
    fs.writeFileSync(path.join(directory,'status.json'),JSON.stringify(finalStatus,null,2));
    const messages=history.messages||[];
    const assistants=messages.map(row=>row.message||row).filter(row=>row.role==='assistant');
    const final=assistants.at(-1);
    const finalText=typeof final?.content==='string'?final.content:(final?.content||[]).filter(part=>part.type==='text').map(part=>part.text).join('\n');
    const parentModels=[...new Set(assistants.filter(row=>row.model).map(row=>`${row.provider}/${row.model}`))];
    const checks={tierDone:finalStatus.phase==='done'&&finalStatus.complete===true,modelPinned:finalStatus.expectedModel===model&&finalStatus.modelMismatches===0,allParentModels:parentModels.length>0&&parentModels.every(value=>value===model),artifact:fs.existsSync(target)&&fs.readFileSync(target,'utf8').trim()===expected,finalReply:Boolean(finalText?.trim())&&!/^NO_REPLY/.test(finalText)};
    passed=Object.values(checks).every(Boolean);
    const result={tier,passed,sessionKey,checks,parentModels,finalText,completedRoles:finalStatus.completedRoles};
    results.push(result);console.log(JSON.stringify(result));
    return result;
  } catch(error) {
    const result={tier,passed:false,sessionKey,error:String(error.message||error)};
    results.push(result);console.log(JSON.stringify(result));return result;
  } finally {
    if(!passed) await rpc('pinkie.deepThink.disarm',{sessionKey}).catch(()=>{});
    fs.writeFileSync(path.join(root,'results.json'),JSON.stringify({model,results},null,2));
  }
}
// Two isolated sessions at a time keep the host responsive during a full-tier test.
for(let offset=0;offset<tiers.length;offset+=2) await Promise.all(tiers.slice(offset,offset+2).map(scenario));
console.log(JSON.stringify({root,passed:results.every(row=>row.passed),results:results.map(({tier,passed})=>({tier,passed}))}));
process.exitCode=results.every(row=>row.passed)?0:1;
