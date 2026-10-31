import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {runProcess,extractFile,archiveMember,withArchiveFile,subtitlePages} from './learning-materials-extract.mjs';

export function cleanOCR(text){return String(text).replace(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu,'$1').replace(/，/g,',').replace(/；/g,';').replace(/：/g,':').replace(/（/g,'(').replace(/）/g,')').trim();}
export function parseTSV(tsv){const words=String(tsv).trim().split(/\r?\n/).slice(1).map(line=>line.split('\t')).filter(c=>c.length>=12&&Number(c[10])>=0&&c[11].trim());const groups=new Map();for(const word of words){const key=word.slice(1,5).join(':');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(word[11]);}return {text:cleanOCR([...groups.values()].map(w=>w.join(' ')).join('\n')),confidence:words.length?words.reduce((n,w)=>n+Number(w[10]),0)/words.length:0};}
export function formulaRisk(subject,text,confidence){return ['math','ee'].includes(subject)&&(confidence<70||(String(text).match(/[=+−×÷∫∑√^_{}()|/]/g)||[]).length>=3||(String(text).match(/(?:^|\s)[a-zA-Z](?=\s|$)/g)||[]).length>=4);}
export function nightWindow(now=new Date()){const minutes=now.getHours()*60+now.getMinutes();return minutes>=23*60+30||minutes<7*60;}
export const acPower=value=>String(value).includes('AC Power');
// macOS os.freemem() counts only completely free pages (often <100 MB on an 8 GB Mac), so the
// 1 GB gate would never open. Use free + inactive + speculative from vm_stat, sampled every 10 s.
export function parseVmStat(text){const page=Number(/page size of (\d+)/.exec(text)?.[1]||16384);const pages=k=>Number(new RegExp(`Pages ${k}:\\s+(\\d+)`).exec(text)?.[1]||0);return (pages('free')+pages('inactive')+pages('speculative'))*page;}
const memorySample={at:0,bytes:null,pending:false};
export function availableMemory(runner=runProcess){
 if(process.platform!=='darwin')return os.freemem();
 if(!memorySample.pending&&Date.now()-memorySample.at>10000){memorySample.pending=true;Promise.resolve().then(()=>runner('vm_stat',[],{timeoutMs:5000,nice:0})).then(out=>{const bytes=parseVmStat(String(out?.stdout??out));if(bytes>0)memorySample.bytes=bytes;}).catch(()=>{}).finally(()=>{memorySample.at=Date.now();memorySample.pending=false;});}
 if(memorySample.bytes===null){try{memorySample.bytes=parseVmStat(execFileSync('vm_stat',{timeout:3000}).toString())||null;memorySample.at=Date.now();}catch{}}
 return memorySample.bytes??os.freemem();
}
export class LearningMaterialsJobs {
 constructor(materials,{freeMemory=()=>availableMemory(runner),onPower=null,now=()=>new Date(),runner=runProcess,kinds=null}={}){this.materials=materials;this.kinds=kinds;this.freeMemory=freeMemory;this.onPower=onPower||(()=>runner('pmset',['-g','batt'],{timeoutMs:5000}));this.now=now;this.runner=runner;this.active=new Map();this.stopped=false;this.currentKind=null;this.retryAfter=new Map();}
 start(){this.stopped=false;this.timer=setInterval(()=>this.tick().catch(error=>{this.lastError=error.message;}),500);this.timer.unref?.();}
 async stop(){this.stopped=true;clearInterval(this.timer);for(const entry of this.active.values())entry.controller.abort();await Promise.allSettled([...this.active.values()].map(entry=>entry.promise));}
 async tick(){
  if(this.stopped||this.checking||this.directVision)return;this.checking=true;
  try{
   const m=this.materials;if(this.freeMemory()<1024**3){for(const entry of this.active.values())entry.controller.abort();m.exec("UPDATE jobs SET reason=CASE WHEN kind!='map' AND json_extract(payload,'$.rootId') IN (SELECT id FROM roots WHERE mounted=0) THEN '等U盘' ELSE '可用内存低于 1 GB，等待' END WHERE state='waiting'");return;}
   const activeKind=[...this.active.values()][0]?.kind;const slots=activeKind==='ocr'?2:1;if(this.active.size>=slots)return;
   const jobs=m.query("SELECT * FROM jobs WHERE state='waiting' ORDER BY CASE kind WHEN 'scan' THEN 0 WHEN 'vision' THEN 1 WHEN 'map' THEN 2 WHEN 'ocr' THEN 3 ELSE 4 END,priority DESC,id");
   for(const job of jobs){if(this.kinds&&!this.kinds.includes(job.kind))continue;if((this.retryAfter.get(job.id)||0)>Date.now())continue;if(this.active.size>=slots)break;if(activeKind&&job.kind!==activeKind)continue;const payload=JSON.parse(job.payload),root=m.one('SELECT * FROM roots WHERE id=?',payload.rootId);if(!root?.mounted&&job.kind!=='map'){m.exec("UPDATE jobs SET reason='等U盘' WHERE id=?",job.id);continue;}
    if(job.kind==='map'&&m.one("SELECT count(*) n FROM pages WHERE source=? AND method='pending'",payload.source)?.n){m.exec("UPDATE jobs SET reason='等待文字识别' WHERE id=?",job.id);continue;}
    if(job.kind==='transcribe'){
     if(!m.tools.ffmpeg||!m.tools.whisper){m.exec("UPDATE jobs SET state='failed',reason='缺少 ffmpeg、whisper-cli 或 medium 模型' WHERE id=?",job.id);continue;}
     const allowed=m.manualTranscribe||nightWindow(this.now())&&acPower(await this.onPower());if(!allowed||this.freeMemory()<2.5*1024**3){m.exec("UPDATE jobs SET reason=? WHERE id=?",!allowed?'等待夜间接电，或点现在转':'可用内存低于 2.5 GB',job.id);continue;}
    }
    if(this.stopped)return;this.launch(job,payload,root);if(job.kind!=='ocr')break;
   }
  }finally{this.checking=false;}
 }
 async acquireVision(){if(this.currentKind==='transcribe')return false;this.directVision=(this.directVision||0)+1;const interrupted=[...this.active.values()].filter(entry=>['scan','ocr'].includes(entry.kind));for(const entry of interrupted)entry.controller.abort();await Promise.allSettled(interrupted.map(entry=>entry.promise));let released=false;return ()=>{if(!released){this.directVision--;released=true;}};}
 launch(job,payload,root){const m=this.materials,controller=new AbortController(),started=Date.now();m.controllers.set(job.id,{controller,rootId:payload.rootId,kind:job.kind});m.exec("UPDATE jobs SET state='running',reason='' WHERE id=?",job.id);this.currentKind=job.kind;
  const promise=(async()=>{
   try{
    if(job.kind==='scan'){if(payload.probe){const video=m.one('SELECT * FROM videos WHERE id=?',payload.videoId),file=await m.sourcePath(video);const output=JSON.parse(await this.runner('ffprobe',['-v','error','-show_entries','format=duration','-of','json',file],{signal:controller.signal,timeoutMs:30000}));m.exec('UPDATE videos SET duration=? WHERE id=?',Number(output.format?.duration)||0,video.id);}else{await m.scanRoot(root,{force:payload.force,signal:controller.signal});const points=m.preferredPoints();await m.prioritize(points);await this.queueTranscriptions(points.map(p=>p.k));}}
    else if(job.kind==='ocr')await this.ocr(payload,{signal:controller.signal});
    else if(job.kind==='map')await m.mapSource(payload.source);
    else if(job.kind==='vision'){const source=m.one('SELECT * FROM sources WHERE id=?',payload.source),page=m.one('SELECT * FROM pages WHERE source=? AND loc=?',payload.source,payload.loc);if(source&&page)await m.readVision(source,page,{signal:controller.signal});}
    else if(job.kind==='transcribe')await this.transcribe(payload,{signal:controller.signal});
    if(controller.signal.aborted)throw new Error('任务已暂停');m.exec("UPDATE jobs SET state='done',done=total,reason='',ms=? WHERE id=?",Date.now()-started,job.id);
   }catch(error){const row=m.one('SELECT state FROM jobs WHERE id=?',job.id);const state=row?.state==='paused'?'paused':controller.signal.aborted?'waiting':/模型|超时|连接失败|看图|内存|U盘/.test(error.message)?'waiting':'failed';if(state==='waiting')this.retryAfter.set(job.id,Date.now()+60000);m.exec('UPDATE jobs SET state=?,reason=?,ms=? WHERE id=?',state,String(error.message).slice(0,1000),Date.now()-started,job.id);}
   finally{m.controllers.delete(job.id);this.active.delete(job.id);this.currentKind=[...this.active.values()][0]?.kind||null;}
  })();this.active.set(job.id,{controller,promise,kind:job.kind});return promise;
 }
 async ocr({source:sourceId,loc},{signal}={}){
  const m=this.materials,source=m.one('SELECT * FROM sources WHERE id=?',sourceId);if(!source)return;const file=await m.sourcePath(source);if(source.ext!=='.pdf')return;for(const tool of ['pdftoppm','tesseract'])if(m.tools[tool]===false){m.exec("UPDATE sources SET status='unsupported',error=? WHERE id=?",'缺少工具 '+tool,sourceId);throw new Error('缺少工具 '+tool);}
  const render=target=>this.runner('pdftoppm',['-r','200','-gray','-f',String(loc),'-l',String(loc),'-singlefile','-png',target],{signal,binary:true,nice:15});
  const image=source.member?await withArchiveFile(file,source.member,m.root,render,{signal}):await render(file);
  const parsed=parseTSV(await this.runner('tesseract',['stdin','stdout','-l','chi_sim+eng','--psm','6','tsv'],{signal,input:image,nice:15}));
  m.exec("UPDATE pages SET text=?,method='ocr',confidence=?,formula_risk=? WHERE source=? AND loc=?",parsed.text,parsed.confidence,Number(formulaRisk(source.subject,parsed.text,parsed.confidence)),sourceId,loc);m.exec('DELETE FROM pages_fts WHERE source=? AND loc=?',sourceId,loc);
  const {indexTokens}=await import('./learning-library.mjs');m.exec('INSERT INTO pages_fts VALUES(?,?,?)',sourceId,loc,indexTokens(parsed.text));m.bump();return parsed;
 }
 async queueTranscriptions(preferred=[]){const m=this.materials;const rows=m.query("SELECT * FROM videos WHERE (transcript_id IS NULL OR transcript_id='') AND gone=0");for(const video of rows){const chapters=JSON.parse(video.chapters||'[]');let priority=preferred.some(k=>chapters.includes(k))?50:video.pack==='主课程123讲'?20:video.pack==='上岸班2023_主体'&&video.number>=164?0:null;if(priority==null)continue;m.enqueue('transcribe',video.id,{rootId:video.root_id,videoId:video.id},priority);}}
 async transcribe({videoId},{signal}={}){
  const m=this.materials,video=m.one('SELECT * FROM videos WHERE id=?',videoId);if(!video||video.transcript_id)return;
  const file=await m.sourcePath(video),directory=await fsp.mkdtemp(path.join(m.root,'transcribe-')),wav=path.join(directory,'audio.wav'),prefix=path.join(directory,'result');
  const gate=new AbortController(),abort=()=>gate.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)gate.abort();
  const interval=setInterval(async()=>{try{if(!m.manualTranscribe&&(!nightWindow(this.now())||!acPower(await this.onPower())))gate.abort();}catch{gate.abort();}},15000);interval.unref?.();
  try{
   await this.runner('ffmpeg',['-nostdin','-v','error','-i',file,'-vn','-ac','1','-ar','16000','-f','wav',wav],{signal:gate.signal,nice:19,timeoutMs:3600000});
   const progress=chunk=>{const marks=[...String(chunk).matchAll(/(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/g)];if(!marks.length)return;const mark=marks.at(-1),seconds=Number(mark[1])*3600+Number(mark[2])*60+Number(mark[3])+Number(mark[4])/1000;const job=m.one("SELECT id,payload FROM jobs WHERE kind='transcribe' AND json_extract(payload,'$.videoId')=?",videoId);if(job)m.exec('UPDATE jobs SET payload=? WHERE id=?',JSON.stringify({...JSON.parse(job.payload),currentVideo:video.title,progressSec:seconds,durationSec:video.duration||0}),job.id);};
   await this.runner('whisper-cli',['-m',path.join(os.homedir(),'models/whisper/ggml-medium.bin'),'-l','zh','-t','4','-osrt','-of',prefix,'-f',wav],{signal:gate.signal,nice:19,timeoutMs:24*3600000,maxBytes:2*1024*1024,onData:progress});
   const pages=subtitlePages(await fsp.readFile(prefix+'.srt','utf8')),id=video.id,mtime=m.now();
   m.exec("INSERT OR REPLACE INTO sources(id,root_id,rel,member,ext,subject,role,path_role,size,mtime,status,error) VALUES(?,?,?,'','.srt',?,'teach','teach',0,?,'indexed','')",id,video.root_id,video.rel,video.rel.startsWith('01_英语')?'en':'math',mtime);
   const {indexTokens}=await import('./learning-library.mjs');m.exec('DELETE FROM pages WHERE source=?',id);m.exec('DELETE FROM pages_fts WHERE source=?',id);for(const page of pages){m.exec("INSERT INTO pages(source,loc,label,text,method,start_sec) VALUES(?,?,?,?,'transcript',?)",id,page.loc,page.label,page.text,page.startSec||0);m.exec('INSERT INTO pages_fts VALUES(?,?,?)',id,page.loc,indexTokens(page.text));}m.exec('UPDATE sources SET generated=1 WHERE id=?',id);m.exec('UPDATE videos SET transcript_id=? WHERE id=?',id,videoId);m.bump();
  }finally{clearInterval(interval);signal?.removeEventListener('abort',abort);await fsp.rm(directory,{recursive:true,force:true});}
 }
}
