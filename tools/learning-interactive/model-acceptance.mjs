// Opt-in, paid acceptance against the user's configured Gemini 3.8 endpoint.
// Data is entirely synthetic and isolated; never mutates the user's sessions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningInteractionStore, createLearningActivityTool, learningPrompt} from '../../services/mode-architecture/learning.mjs';
if (!process.argv.includes('--real-gemini')) throw Error('Real model acceptance requires --real-gemini');
const out = process.env.PINKIE_QA_OUTPUT || os.tmpdir();
const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.openclaw/openclaw.json'), 'utf8'));
const provider = config.models.providers.mm;
if (!provider.baseUrl || typeof provider.apiKey !== 'string') throw Error('Configured provider is unavailable');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-learning-model-'));
const store = new LearningInteractionStore({root, workspace: path.join(root, 'workspace')});
const cases = [
  {name:'zener', kind:'device_lab', device:'zener', paused:true, question:'并联型稳压电路：输入12V，限流电阻330Ω，负载1kΩ，稳压管5.1V。我想理解输入或负载改变后会怎样，帮我直观讲清稳压电流和功率。'},
  {name:'decoder', kind:'device_lab', device:'decoder138', question:'74LS138 的输出为什么低有效？现在 A=1、B=0、C=1，G1=1、G2A=G2B=0，帮我直观看懂哪一路有效，改变输入又会怎样。'},
  {name:'multiplexer', kind:'device_lab', device:'mux151', question:'74LS151 八选一，CBA=010，D2=1，G=0。Y和W是什么关系？如果改选择输入或者禁止输出，会发生什么？请讲清这条信号怎么走。'},
  {name:'counter', kind:'device_lab', device:'counter161', question:'74LS161 现在Q=15，ENP=ENT=1。CP来一个上升沿后会怎样？/CLR 和 /LOAD 一个叫异步一个叫同步，我一直分不清，直观解释一下。'},
  {name:'memory', kind:'memory_lab', question:'这段程序的 p 和 pp 怎么指向？请按执行步骤把内存关系讲清楚：\n#include <stdio.h>\nint main(void){int a[3]={10,20,30};int *p=a;int **pp=&p;p++;**pp=42;printf("%d\\n",a[1]);return 0;}'},
  {name:'illustrated', kind:'illustrated_guide', question:'请把稳压电路和74LS138排成左边小插图、右边解释的图文说明，附一张功能对比表，再给横版1920×1130和竖版1080×1440两个排版比例。用教学示意图，先不需要生成图片。'},
  {name:'simple_fact', kind:null, question:'电阻的单位是什么？一句话。'},
  {name:'text_only', kind:null, question:'我现在只要文字，不放图、题卡或交互：两句话说明74LS161的异步清零和同步装数。'},
];
const report = {status:'running', model:'gemini-3.8-flash-tiered', startedAt:new Date().toISOString(), cases:[], usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}};
try {
  for (const scenario of cases.filter(c => !process.env.PINKIE_QA_CASE || c.name === process.env.PINKIE_QA_CASE)) {
    const sessionKey = 'agent:learning:qa-' + scenario.name;
    if (scenario.paused) store.setEnabled(sessionKey, false);
    const tool = createLearningActivityTool(store, {sessionKey});
    const started = Date.now();
    const response = await fetch(new URL('chat/completions', provider.baseUrl.replace(/\/?$/, '/')), {method:'POST', signal:AbortSignal.timeout(90000), headers:{'Content-Type':'application/json',Authorization:'Bearer '+provider.apiKey}, body:JSON.stringify({model:report.model, max_tokens:1800, messages:[{role:'system',content:learningPrompt(store,sessionKey)},{role:'user',content:scenario.question}], tools:[{type:'function',function:{name:tool.name,description:tool.description,parameters:tool.parameters}}], tool_choice:'auto'})});
    if (!response.ok) throw Error('Model acceptance HTTP ' + response.status);
    const data = await response.json(), message = data.choices?.[0]?.message;
    for (const name of Object.keys(report.usage)) report.usage[name] += data.usage?.[name] || 0;
    const row = {name:scenario.name, question:scenario.question, returnedModel:data.model, elapsedMs:Date.now()-started, status:'failed', calls:[], usage:data.usage};
    const calls = message?.tool_calls || [];
    if (!scenario.kind) row.status = calls.length === 0 ? 'passed' : 'failed';
    else {
      for (const call of calls) {
        const params = JSON.parse(call.function.arguments), result = await tool.execute(call.id, params);
        row.calls.push({params,isError:result.isError,kind:result.details?.inline?.kind,device:result.details?.visual?.definition?.device,
          ...(result.details?.visual?.state?.result?{realRun:{stdout:result.details.visual.state.result.stdout,verifiedTrace:result.details.visual.state.result.trace?.verifiedOutput}}:{})});
      }
      row.status = row.calls.length === 1 && !row.calls[0].isError && row.calls[0].kind === scenario.kind && (!scenario.device || row.calls[0].device === scenario.device) ? 'passed' : 'failed';
      if (scenario.name === 'zener') { const v = row.calls[0]?.params?.visual?.values || {}; if (v.Vin!==12 || v.R!==330 || v.RL!==1000 || v.Vz!==5.1 || Object.keys(v).some(k=>!['Vin','R','RL','Vz'].includes(k))) row.status='failed'; }
      if (scenario.name === 'memory' && row.calls[0]?.realRun?.verifiedTrace !== true) row.status = 'failed';
    }
    report.cases.push(row); console.log(JSON.stringify({name:row.name,status:row.status,elapsedMs:row.elapsedMs,calls:row.calls.length}));
    fs.writeFileSync(path.join(out,'learning-real-model.json'),JSON.stringify(report,null,2));
  }
  report.status = report.cases.every(c => c.status === 'passed') ? 'passed' : 'failed';
} finally {
  report.completedAt = new Date().toISOString(); fs.writeFileSync(path.join(out,'learning-real-model.json'),JSON.stringify(report,null,2)); fs.rmSync(root,{recursive:true,force:true});
}
if (report.status !== 'passed') process.exitCode = 1;
