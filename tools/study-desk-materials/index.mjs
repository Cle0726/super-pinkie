#!/usr/bin/env node
// Development survey/index runner: no model configuration or OpenClaw access.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {LearningMaterials} from '../../services/mode-architecture/learning-materials.mjs';
import {LearningMaterialsJobs,availableMemory} from '../../services/mode-architecture/learning-materials-jobs.mjs';
import {snapshot,compareSnapshots} from './survey.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),args=process.argv.slice(2);let store,ocr=false;
for(let i=0;i<args.length;i++){if(args[i]==='--store'&&args[i+1])store=path.resolve(args[++i]);else if(args[i]==='--ocr')ocr=true;else throw new Error('用法：index.mjs [--store 本机目录] [--ocr]');}
const m=new LearningMaterials(store?{root:store}:{}),delay=monitorEventLoopDelay({resolution:10}),started=Date.now();let jobs;
try{
 await m.init();const roots=m.status().roots.filter(root=>root.mounted),before=new Map();for(const root of roots)before.set(root.id,await snapshot(root.path));delay.enable();
 await m.scan();jobs=new LearningMaterialsJobs(m,{kinds:ocr?['scan','ocr']:['scan']});m.scheduler=jobs;
 const allowed=ocr?['scan','ocr']:['scan'];let previous=0;
 for(;;){await jobs.tick();const pending=m.query("SELECT kind,count(*) n FROM jobs WHERE state IN ('waiting','running') GROUP BY kind").filter(row=>allowed.includes(row.kind));if(!pending.length&&!jobs.active.size)break;if(availableMemory()<1024**3&&!jobs.active.size)break;
  if(Date.now()-previous>30000){process.stderr.write(JSON.stringify({elapsedSec:Math.round((Date.now()-started)/1000),files:m.status().files,pages:m.status().pages,jobs:m.status().jobs})+'\n');previous=Date.now();}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 await jobs.stop();delay.disable();const audits=[];for(const root of roots)audits.push({root:root.path,...compareSnapshots(before.get(root.id),await snapshot(root.path))});
 const result={createdAt:new Date().toISOString(),store:m.root,ms:Date.now()-started,freeMemoryBytes:availableMemory(),eventLoopMaxMs:delay.max/1e6,status:m.status(),audits,modelCalls:0};
 await fs.writeFile(path.join(here,'index-run.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result,null,2)+'\n');
 if(audits.some(audit=>!audit.unchanged))process.exitCode=1;
}finally{delay.disable();await m.close();}
