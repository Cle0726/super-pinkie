import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {traceC} from './learning-c-trace.mjs';
let active=0;
export async function runLearningCompute(kind, state) {
  if(kind==='memory_lab')kind='c_program';
  if(!['c_program','math_check'].includes(kind))throw Error('不支持这种运行');
  if(active>=2)throw Error('已有两项计算在运行，请稍后再试');
  const local=path.join(os.homedir(),'.openclaw/pinkie-learning-runtime/bin/python3');
  const python=process.env.PINKIE_LEARNING_PYTHON || (fs.existsSync(local)?local:'/usr/bin/python3');
  const script=fileURLToPath(new URL('./learning-engine.py',import.meta.url));
  active++;
  try {
    const data=await new Promise((resolve,reject)=>{
      const child=spawn(python,['-I',script],{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8'},detached:process.platform!=='win32'});
      let output='',errors='',done=false;
      const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};
      const kill=()=>{try{process.platform==='win32'?child.kill('SIGKILL'):process.kill(-child.pid,'SIGKILL');}catch{}};
      const timer=setTimeout(()=>{kill();finish(Error('计算超时，请缩短程序或表达式'));},18000);timer.unref?.();
      child.stdout.on('data',chunk=>{output+=chunk;if(output.length>2_000_000){kill();finish(Error('计算结果过大'));}});
      child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-1500);});
      child.on('error',()=>finish(Error('学习计算环境未就绪')));
      child.on('close',code=>{
        if(done)return;
        try{const response=JSON.parse(output);if(!response.ok)throw Error(response.error);finish(null,response.result);}
        catch(error){finish(Error(code?`计算未完成：${errors || '已达到运行限制'}`:error.message));}
      });
      const keys=kind==='c_program'?['code','stdin']:['operation','expression','answer','point'];
      child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({kind,...Object.fromEntries(keys.map(key=>[key,state[key]]))}));
    });
    if(kind==='c_program'){
      const ast=data.ast;delete data.ast;
      data.trace=data.compiled && data.exitCode===0 && !data.timedOut
        ?traceC(ast,state.code,data.stdout):{frames:[],verifiedOutput:false,message:'先完成无错误的真实运行，再观察步骤'};
    }
    return data;
  } finally {active--;}
}
