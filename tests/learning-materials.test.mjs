import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {countPDFPages, excluded, snapshot, compareSnapshots, surveyRoot, toolStatus, main, matchTranscripts} from '../tools/study-desk-materials/survey.mjs';
import {makeFixtures} from '../tools/study-desk-materials/make-fixtures.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('survey counts form-feed pages using the 40 non-whitespace character threshold',()=>{
  assert.deepEqual(countPDFPages('a'.repeat(40)+'\f \n\f'),{pages:2,textPages:1,noTextPages:1,lowTextPages:[2]});
  assert.equal(countPDFPages('\f').pages,1);
  assert.equal(excluded('06_互动学习台/打印版/a.pdf'),true);
  assert.equal(excluded('teach/._a.pdf'),true);
  assert.equal(excluded('teach/a.pdf'),false);
});
test('survey audit includes hidden files, detects mtime changes, and never follows symlinks',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pinkie-survey-audit-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,'._existing'),'x');await fs.symlink('/Volumes',path.join(root,'outside'));
  const a=await snapshot(root),b=await snapshot(root);assert.equal(compareSnapshots(a,b).unchanged,true);
  assert.equal(a.find(e=>e.path==='outside').kind,'link');
  await fs.utimes(path.join(root,'._existing'),new Date(),new Date(Date.now()+2000));
  assert.deepEqual(compareSnapshots(a,await snapshot(root)).changed,['._existing']);
});
test('survey rejects root and symlink outputs before opening a writable file',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pinkie-survey-root-')),out=await fs.mkdtemp(path.join(os.tmpdir(),'pinkie-survey-out-'));
  t.after(()=>Promise.all([fs.rm(root,{recursive:true,force:true}),fs.rm(out,{recursive:true,force:true})]));
  await fs.symlink(root,path.join(out,'link'));
  await assert.rejects(main(['--root',root,'--out',path.join(root,'report.json')]),/输出不能/);
  await assert.rejects(main(['--root',root,'--out',path.join(out,'link','report.json')]),/输出不能/);
  assert.deepEqual(await fs.readdir(root),[]);
});
test('survey imports transcript numbering and same-name subtitles without guessing an ambiguous title',()=>{
  const videos=[{path:'pack/001 电流.mp4',pack:'上岸班2023_主体',number:1},{path:'other/001 其他.mp4',pack:'other',number:1}];
  const result=matchTranscripts(videos,[{path:'视频转写稿/001 电流.txt'},{path:'pack/001 电流.mp4(1).srt'},{path:'视频转写稿/002 没有视频.txt'}]);
  assert.equal(result.matched.length,2);assert.equal(result.unmatched.length,1);
});
test('synthetic survey reads PDF PPTX GBK archives and encrypted flags while leaving all source metadata unchanged',async t=>{
  const tools=await toolStatus();if(!tools.python3||!tools.pdftotext)return t.skip('缺少 python3 或 pdftotext');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pinkie-survey-fixtures-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const fixtures=await makeFixtures(root);await fs.mkdir(path.join(root,'06_互动学习台'));await fs.writeFile(path.join(root,'06_互动学习台','ignored.pdf'),'not a pdf');
  const result=await surveyRoot(root,{tools});
  assert.equal(result.pdf.files,2);assert.equal(result.pdf.pages,3);assert.equal(result.pdf.noTextPages,2);
  assert.equal(result.pptx.files,1);assert.equal(result.pptx.slides,2);assert.equal(result.pptx.withText,2);
  assert.equal(result.archives.find(a=>a.path==='gbk.zip').members[0].path,'中文讲义.txt');
  if(fixtures.encrypted)assert.equal(result.archives.find(a=>a.path==='encrypted.zip').encrypted,true);
  assert.equal(result.readOnly.unchanged,true);assert.match(result.readOnly.statement,/未写入/);
  assert.equal(result.unsupported[0].path,'legacy.ppt');
});
import {LearningMaterials,materialRole,materialSubject,createLearningMaterialTool,P4,P5,P6} from '../services/mode-architecture/learning-materials.mjs';
import {LearningMaterialsJobs,parseTSV,formulaRisk,nightWindow,acPower} from '../services/mode-architecture/learning-materials-jobs.mjs';
import {subtitlePages} from '../services/mode-architecture/learning-materials-extract.mjs';
async function indexFixture(t,options={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pinkie-materials-'));const input=path.join(root,'source'),teach=path.join(input,'04_电工电子','01_课件');await fs.mkdir(teach,{recursive:true});await makeFixtures(teach);
 const materials=new LearningMaterials({root:path.join(root,'index'),roots:[{id:'zsb',path:input,label:'合成讲义'}],freeMemory:()=>4*1024**3,...options});await materials.init();t.after(async()=>{await materials.close();await fs.rm(root,{recursive:true,force:true});});return {root,input,teach,materials};
}
test('material role and subject rules keep all answer/practice paths out of teaching results',()=>{
 for(const name of ['讲义/答案.pdf','课件/参考答案.docx','课件/解析.txt','题库/a.pdf','模拟卷/a.pdf','模拟试卷/a.pdf','真题/a.pdf','试卷/a.pdf','通关卷/a.pdf','押题/a.pdf','习题/a.pdf','作业/a.pdf','jie哥800题/a.pdf'])assert.equal(materialRole(name),'bank',name);
 for(const name of ['课件/a.pdf','讲义/a.txt','知识点/a.docx','考点/a.pdf','笔记/a.md','视频转写稿/a.txt','学习指南.md','词汇.pdf','作文手册.pdf','速记.pdf','口袋书.pdf','参考书.pdf','教案.pdf','重点.pdf'])assert.equal(materialRole(name),'teach',name);
 assert.equal(materialRole('其他/readme.txt'),'other');assert.equal(materialSubject('zsb','02_高数/讲义.pdf'),'math');assert.equal(materialSubject('pretco-b-usb','任意/讲义.pdf'),'pretco');assert.equal(materialSubject('zsb','05_计算机网络/a.pptx'),'net');
});
test('incremental extraction preserves original mtimes, reads GBK archive members, retains gone text, and pauses on detach',async t=>{
 const {input,teach,materials:m}=await indexFixture(t);const before=await snapshot(input);await m.scanRoot(m.status().roots[0]);const count=m.status().pages.total,jobs=m.one('SELECT count(*) n FROM jobs').n;
 const gbk=m.one("SELECT * FROM sources WHERE member='中文讲义.txt'");assert.equal(gbk.status,'indexed');assert.match(m.one('SELECT text FROM pages WHERE source=?',gbk.id).text,/Synthetic archive/);
 assert.ok(m.unsupported().some(item=>item.path.endsWith('legacy.ppt')));assert.ok(m.unsupported().some(item=>item.reason.includes('加密')));
 await m.scanRoot(m.status().roots[0]);assert.equal(m.status().pages.total,count);assert.equal(m.one('SELECT count(*) n FROM jobs').n,jobs);assert.equal(compareSnapshots(before,await snapshot(input)).unchanged,true);
 const source=m.one("SELECT * FROM sources WHERE rel LIKE '%/gbk.txt'");await fs.unlink(path.join(teach,'gbk.txt'));await m.scanRoot(m.status().roots[0]);assert.equal(m.one('SELECT status FROM sources WHERE id=?',source.id).status,'gone');const read=await m.read(`m:${source.id}:1`,{vision:'never'});assert.match(read.pages[0].text,/中文讲义/);assert.equal(read.original,'offline');
 const controller=new AbortController();m.controllers.set('fake-ocr',{controller,rootId:'zsb',kind:'ocr'});await fs.rename(input,input+'-offline');await m.discover();assert.equal(controller.signal.aborted,true);assert.equal(m.status().roots[0].mounted,false);await assert.rejects(m.pageImage({ref:`m:${source.id}:1`}),/插上U盘可以看原页/);await fs.rename(input+'-offline',input);await m.discover();assert.equal(m.status().roots[0].mounted,true);
});
test('search/read expose only teach data; P5 validates ranges and chapters, and cached P6 fallback runs once',async t=>{
 let mapCalls=0,pickCalls=0;const {teach,input,materials:m}=await indexFixture(t,{requestModel:async(rules)=>{if(rules===P5){mapCalls++;return {value:{role:'bank',parts:[{from:1,to:1,chapters:['ee1'],topic:'电流'},{from:1,to:900,chapters:['ee1']},{from:1,to:1,chapters:['invented']}]},model:{name:'fixture'},usage:{total:10},ms:1};}if(rules===P6){pickCalls++;throw new Error('timeout');}throw new Error('unexpected model');}});
 for(let i=0;i<8;i++)await fs.writeFile(path.join(teach,`电流${i}.md`),'# 电流\n电流是电荷的定向移动。电压与电功率。');const bank=path.join(input,'04_电工电子','03_题库');await fs.mkdir(bank,{recursive:true});await fs.writeFile(path.join(bank,'答案.md'),'电流是电荷的定向移动。');await m.scanRoot(m.status().roots[0]);
 const source=m.one("SELECT * FROM sources WHERE rel LIKE '%电流0.md'");await m.mapSource(source.id);assert.equal(mapCalls,1);assert.equal(JSON.parse(m.one('SELECT map_json FROM sources WHERE id=?',source.id).map_json).parts.length,1);assert.equal(m.one('SELECT role FROM sources WHERE id=?',source.id).role,'teach');await m.mapSource(source.id);assert.equal(mapCalls,1);
 const hidden=m.one("SELECT * FROM sources WHERE rel LIKE '%答案.md'");await m.mapSource(hidden.id);assert.equal(mapCalls,1);await assert.rejects(m.read(`m:${hidden.id}:1`),/讲解类资料/);
 const hits=m.search({query:'电流'}).hits;assert.ok(hits.length);assert.equal(hits.some(p=>p.title.includes('答案')),false);const located=await m.locate({k:'ee1',i:0});assert.equal(located.pages.length,6);await m.locate({k:'ee1',i:0});assert.equal(pickCalls,1);assert.equal(createLearningMaterialTool(m,{sessionKey:'agent:project:x'}),null);const tool=createLearningMaterialTool(m,{sessionKey:'agent:learning:x'});assert.equal((await tool.execute('x',{action:'read',ref:`m:${hidden.id}:1`})).isError,true);
});test('interactive reads use a 512 MB memory gate, background vision keeps 1 GB',async t=>{
 let free=768*1024**2,calls=0;const f=await indexFixture(t,{freeMemory:()=>free,requestModel:async()=>{calls++;return {value:'# 合成原页\n这是一段足够长的模型抄录文字，含公式 $r_i=U_i/I_i$。\n<!-- quality: good -->',model:{name:'fixture'},usage:{total:3},ms:1};}}),m=f.materials;await m.scanRoot(m.status().roots[0]);const blank=m.one("SELECT * FROM sources WHERE rel LIKE '%/blank.pdf'"),row=m.one('SELECT * FROM pages WHERE source=? AND loc=1',blank.id);
 assert.equal(await m.readVision(blank,row),null);assert.equal(calls,0);
 assert.equal((await m.read(`m:${blank.id}:1`)).pages[0].readBy,'vision');assert.equal(calls,1);
 m.exec('DELETE FROM reads');free=256*1024**2;const low=(await m.read(`m:${blank.id}:1`)).pages[0];assert.equal(low.readBy,'unread');assert.match(low.note,/看原页/);assert.equal(calls,1);
});

test('vision cache, daily budget and unreadable fallback preserve OCR; original preview and reveal enforce root bounds',async t=>{
 let calls=0;const requests=[];const f=await indexFixture(t,{visionDaily:1,requestModel:async(rules,payload,options)=>{assert.equal(rules,P4);requests.push(options);calls++;return {value:'# 合成原页\n这是一段足够长的模型抄录文字，含准确公式 $u_C(0^-)=u_C(0^+)$。\n<!-- quality: good -->',model:{name:'fixture'},usage:{input:10,output:20,total:30},ms:1};}}),m=f.materials;await m.scanRoot(m.status().roots[0]);const source=m.one("SELECT * FROM sources WHERE rel LIKE '%/text.pdf'");const ref=`m:${source.id}:2`;
 const first=await m.read(ref);assert.equal(first.pages[0].readBy,'vision');assert.equal(calls,1);assert.ok(requests[0].images[0].base64.length);assert.match(requests[0].userText,/第 2 页/);assert.equal((await m.read(ref)).pages[0].readBy,'vision');assert.equal(calls,1);
 const blank=m.one("SELECT * FROM sources WHERE rel LIKE '%/blank.pdf'");const unread=(await m.read(`m:${blank.id}:1`)).pages[0];assert.equal(unread.readBy,'unread');assert.match(unread.note,/还没认字/);assert.equal(calls,1);assert.match(m.status().visionBudget.reason,/额度用完/);
 const preview=await m.pageImage({ref});assert.ok(preview.width>0&&preview.height>0&&Math.max(preview.width,preview.height)<=1200);assert.equal((await m.pageImage({ref})).dataUrl,preview.dataUrl);
 m.exec('UPDATE roots SET mounted=0');assert.equal((await m.read(ref)).pages[0].readBy,'vision');await assert.rejects(m.pageImage({ref}),/插上U盘/);m.exec('UPDATE roots SET mounted=1');
 await fs.writeFile(path.join(f.root,'outside.pdf'),'outside');m.exec("UPDATE sources SET rel='../outside.pdf' WHERE id=?",source.id);await assert.rejects(m.reveal({ref}),/越界/);
 const g=await indexFixture(t,{requestModel:async()=>({value:'看不清\n<!-- quality: unreadable -->',usage:{total:1},model:{name:'fixture'},ms:1})});await g.materials.scanRoot(g.materials.status().roots[0]);const gs=g.materials.one("SELECT * FROM sources WHERE rel LIKE '%/blank.pdf'");assert.equal((await g.materials.read(`m:${gs.id}:1`)).pages[0].readBy,'unread');assert.equal(g.materials.one('SELECT count(*) n FROM reads').n,0);
});
test('OCR TSV keeps words in line order, flags math risk, and uses array process args at nice 15',async t=>{
 const tsv='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t80\t电\n5\t1\t1\t1\t1\t2\t10\t0\t10\t10\t60\t压\n';assert.deepEqual(parseTSV(tsv),{text:'电压',confidence:70});assert.equal(formulaRisk('math','x = y + z / 2',90),true);assert.equal(formulaRisk('en','x = y + z / 2',20),false);
 const {materials:m}=await indexFixture(t);await m.scanRoot(m.status().roots[0]);const row=m.one("SELECT p.* FROM pages p JOIN sources s ON s.id=p.source WHERE s.ext='.pdf' AND p.method='pending' LIMIT 1"),calls=[];
 const jobs=new LearningMaterialsJobs(m,{runner:async(command,args,options)=>{calls.push({command,args,options});return command==='pdftoppm'?Buffer.from('fixture'):tsv;}});await jobs.ocr({source:row.source,loc:row.loc});assert.equal(m.one('SELECT method FROM pages WHERE source=? AND loc=?',row.source,row.loc).method,'ocr');assert.ok(calls.every(c=>Array.isArray(c.args)&&c.options.nice===15));assert.equal(calls[1].args.at(-1),'tsv');
});
test('transcription gates, subtitles, interruption cleanup and local-only import work without real ffmpeg or whisper',async t=>{
 assert.equal(nightWindow(new Date(2026,9,26,23,30)),true);assert.equal(nightWindow(new Date(2026,9,27,7,0)),false);assert.equal(nightWindow(new Date(2026,9,27,6,59)),true);assert.equal(acPower("Now drawing from 'AC Power'"),true);
 const cues='1\n00:12:30,000 --> 00:12:32,000\n电容电压不能突变。\n\n';assert.equal(subtitlePages(cues)[0].startSec,750);assert.equal(subtitlePages(cues)[0].label,'12:30');
 const f=await indexFixture(t),m=f.materials;const videoPath=path.join(f.input,'02_高数','01_视频课','主课程123讲','001 函数.mp4');await fs.mkdir(path.dirname(videoPath),{recursive:true});await fs.writeFile(videoPath,'synthetic video');m.exec("INSERT INTO videos(id,root_id,rel,pack,number,title,duration,chapters) VALUES(?,'zsb',?,'主课程123讲',1,'函数',30,'[\"m1\"]')",'a'.repeat(24),path.relative(f.input,videoPath));
 const before=await snapshot(f.input),commands=[];const jobs=new LearningMaterialsJobs(m,{runner:async(command,args,options)=>{commands.push({command,args,options});if(command==='ffmpeg')await fs.writeFile(args.at(-1),'wav');else if(command==='whisper-cli')await fs.writeFile(args[args.indexOf('-of')+1]+'.srt',cues);return '';}});await jobs.transcribe({videoId:'a'.repeat(24)});assert.equal(m.one('SELECT count(*) n FROM pages WHERE method=\'transcript\'').n,1);assert.equal(m.one('SELECT generated FROM sources WHERE id=?','a'.repeat(24)).generated,1);assert.equal((await fs.readdir(m.root)).some(n=>n.startsWith('transcribe-')),false);assert.equal(compareSnapshots(before,await snapshot(f.input)).unchanged,true);assert.ok(commands.every(c=>c.options.nice===19));
 m.exec('UPDATE videos SET transcript_id=NULL');const controller=new AbortController();const stopped=new LearningMaterialsJobs(m,{runner:async(_command,_args,{signal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});setTimeout(()=>controller.abort(),10);})});await assert.rejects(stopped.transcribe({videoId:'a'.repeat(24)},{signal:controller.signal}),/aborted/);assert.equal((await fs.readdir(m.root)).some(n=>n.startsWith('transcribe-')),false);
});
test('index output cannot resolve inside a read-only source, including through a symlink',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pinkie-index-boundary-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const source=path.join(root,'source');await fs.mkdir(source);await fs.symlink(source,path.join(root,'alias'));const roots=[{id:'zsb',path:source,label:'fixture'}];
 assert.throws(()=>new LearningMaterials({root:path.join(source,'index'),roots}),/索引必须存本机/);assert.throws(()=>new LearningMaterials({root:path.join(root,'alias','index'),roots}),/索引必须存本机/);assert.deepEqual(await fs.readdir(source),[]);
});
test('low-memory jobs never spawn work; manual pause persists across reopen and explicit resume restores waiting',async t=>{
 const {materials:m}=await indexFixture(t);await m.scan();const jobs=new LearningMaterialsJobs(m,{freeMemory:()=>0});await jobs.tick();assert.equal(jobs.active.size,0);assert.match(m.status().jobs.find(j=>j.kind==='scan').reason,/低于 1 GB/);m.jobsControl({kind:'scan',action:'pause'});assert.equal(m.status().jobs.find(j=>j.kind==='scan').state,'paused');const options={root:m.root,roots:m.definitions};await m.close();const restored=new LearningMaterials(options);try{await restored.init();assert.equal(restored.status().jobs.find(j=>j.kind==='scan').state,'paused');restored.jobsControl({kind:'scan',action:'resume'});assert.equal(restored.status().jobs.find(j=>j.kind==='scan').state,'waiting');}finally{await restored.close();}
});
test('a direct vision render is interrupted on root detach and returns retained OCR without calling the model',async t=>{
 let modelCalls=0;const f=await indexFixture(t,{requestModel:async()=>{modelCalls++;throw new Error('must not call');}}),m=f.materials;await m.scanRoot(m.status().roots[0]);const source=m.one("SELECT * FROM sources WHERE rel LIKE '%/blank.pdf'");let ready;const started=new Promise(resolve=>{ready=resolve;});let aborted=false;
 m.runProcess=async(_command,_args,{signal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'));},{once:true});ready();});
 const pending=m.read(`m:${source.id}:1`);await started;await fs.rename(f.input,f.input+'-off');await m.discover();const read=await pending;assert.equal(aborted,true);assert.equal(modelCalls,0);assert.equal(read.pages[0].readBy,'unread');assert.match(read.pages[0].note,/U盘没插/);assert.equal(read.original,'offline');await fs.rename(f.input+'-off',f.input);
});
test('VTT minute timestamps are imported and unmapped subtitle files remain teaching sources',async t=>{
 assert.equal(subtitlePages('WEBVTT\n\n12:30.000 --> 12:32.000\n电容电压。\n\n')[0].startSec,750);const {input,materials:m}=await indexFixture(t);await fs.writeFile(path.join(input,'unmatched.vtt'),'WEBVTT\n\n00:01.000 --> 00:02.000\n电容电压不能突变。\n\n');await m.scanRoot(m.status().roots[0]);assert.equal(m.one("SELECT role FROM sources WHERE rel='unmatched.vtt'").role,'teach');
});

test('jobs on an unplugged root wait for the USB drive, not for memory',async t=>{
 const {materials:m}=await indexFixture(t);await m.scan();m.exec('UPDATE roots SET mounted=0');const reason=()=>m.status().jobs.find(j=>j.kind==='scan').reason;
 await new LearningMaterialsJobs(m,{freeMemory:()=>0}).tick();assert.equal(reason(),'等U盘');
 await new LearningMaterialsJobs(m,{freeMemory:()=>4*1024**3}).tick();assert.equal(reason(),'等U盘');
 m.exec('UPDATE roots SET mounted=1');await new LearningMaterialsJobs(m,{freeMemory:()=>0}).tick();assert.match(reason(),/低于 1 GB/);
});
test('memory gate counts reclaimable macOS pages, not only os.freemem()',async()=>{
  const {parseVmStat}=await import('../services/mode-architecture/learning-materials-jobs.mjs');
  const sample='Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:                                4835.\nPages active:                            200000.\nPages inactive:                          123368.\nPages speculative:                         3031.\n';
  assert.equal(parseVmStat(sample),(4835+123368+3031)*16384);
  assert.ok(parseVmStat(sample)>1024**3,'2 GB reclaimable must open the 1 GB gate');
});
