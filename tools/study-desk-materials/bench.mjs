import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {LearningMaterials} from '../../services/mode-architecture/learning-materials.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'pinkie-materials-bench-'));let m;const monitor=monitorEventLoopDelay({resolution:10});
try{const source=path.join(root,'source');await fs.mkdir(source);await fs.writeFile(path.join(source,'合成讲义.md'),'# 电流\n'+('电流是电荷的定向移动。电压需要注意单位。\n'.repeat(10000)));m=new LearningMaterials({root:path.join(root,'index'),roots:[{id:'zsb',path:source,label:'合成样例'}],freeMemory:()=>4*1024**3});await m.init();monitor.enable();const started=Date.now();await m.scanRoot(m.status().roots[0]);await new Promise(resolve=>setTimeout(resolve,30));monitor.disable();const result={syntheticOnly:true,ms:Date.now()-started,eventLoopMaxMs:monitor.max/1e6,pages:m.status().pages,files:m.status().files};await fs.writeFile(path.join(path.dirname(fileURLToPath(import.meta.url)),'bench.json'),JSON.stringify(result,null,2)+'\n');console.log(result);if(result.eventLoopMaxMs>100)process.exitCode=1;}finally{monitor.disable();await m?.close();await fs.rm(root,{recursive:true,force:true});}
