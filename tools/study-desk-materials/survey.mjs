#!/usr/bin/env node
// B0: source roots are read-only inputs; all subprocess output goes to pipes.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const SKIP = new Set(['.DS_Store', '$RECYCLE.BIN', '.Trashes', 'System Volume Information', '06_互动学习台', '_整理记录']);
const DOCS = new Set(['.doc', '.docx', '.rtf']);
const compact = text => String(text).replace(/\s/gu, '');
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const excluded = relative => relative.split(path.sep).some(n => SKIP.has(n) || n.startsWith('._'));
const inside = (base, target) => target === base || target.startsWith(base + path.sep);
const cleanError = error => String(error.stderr || error.message || error).slice(0, 1500).trim();

export async function runTool(command, args, options = {}) {
  return exec('nice', ['-n', '15', command, ...args], {encoding: 'utf8', timeout: 120000,
    maxBuffer: 64 * 1024 * 1024, env: {...process.env, COPYFILE_DISABLE: '1'}, ...options});
}
export async function toolStatus() {
  const result = {};
  for (const command of ['pdftotext', 'pdfinfo', 'pdftoppm', 'tesseract', 'ffmpeg', 'ffprobe', 'whisper-cli', 'textutil', 'bsdtar', 'python3', 'nice']) {
    const paths = (process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, command));
    result[command] = false;
    for (const file of paths) { try { await fs.access(file, 1); result[command] = true; break; } catch {} }
  }
  result.whisper = result['whisper-cli'];
  try { result.whisperModel = (await fs.stat(path.join(os.homedir(), 'models/whisper/ggml-medium.bin'))).isFile(); } catch { result.whisperModel = false; }
  if (result.tesseract) {
    try { result.tesseractLanguages = (await runTool('tesseract', ['--list-langs'])).stdout.trim().split(/\r?\n/).slice(1); }
    catch { result.tesseractLanguages = []; }
  }
  return result;
}

// Includes excluded files and directory mtimes for the before/after audit. Symlinks
// are recorded but never followed, so a source cannot redirect reads elsewhere.
export async function snapshot(root) {
  const entries = [];
  async function walk(directory, relative = '') {
    const stat = await fs.lstat(directory);
    entries.push({path: relative || '.', kind: stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : 'other', size: stat.size, mtimeMs: stat.mtimeMs});
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    const children = await fs.readdir(directory);
    for (const child of children.sort()) await walk(path.join(directory, child), path.join(relative, child));
  }
  await walk(root);
  return entries;
}
export function compareSnapshots(before, after) {
  const a = new Map(before.map(e => [e.path, e])), b = new Map(after.map(e => [e.path, e]));
  const added = [...b.keys()].filter(k => !a.has(k)), removed = [...a.keys()].filter(k => !b.has(k));
  const changed = [...a.keys()].filter(k => b.has(k) && JSON.stringify(a.get(k)) !== JSON.stringify(b.get(k)));
  return {unchanged: !added.length && !removed.length && !changed.length, beforeHash: sha(before), afterHash: sha(after), beforeEntries: before.length, afterEntries: after.length, added, removed, changed};
}
export function countPDFPages(text) {
  const pages = text.split('\f');
  if (pages.length > 1 && !pages.at(-1).trim()) pages.pop();
  const chars = pages.map(page => [...compact(page)].length);
  return {pages: chars.length, textPages: chars.filter(n => n >= 40).length,
    noTextPages: chars.filter(n => n < 40).length, lowTextPages: chars.flatMap((n, i) => n < 40 ? [i + 1] : [])};
}
export function videoInfo(relative) {
  const parts = relative.split(path.sep), name = path.basename(relative, path.extname(relative));
  const number = Number(name.match(/^\s*(?:第)?(\d+)(?!\d)(?!章)/)?.[1]) || null;
  let pack = parts.slice(0, -1).join('/');
  const lessons = parts.indexOf('01_视频课');
  if (lessons >= 0) {
    pack = parts[lessons + 1];
    if (pack === '杰哥专升本') pack += '/' + (parts[lessons + 2] || '');
  }
  return {pack, number, title: name};
}
export function normalizedTitle(value) {
  let title=path.basename(value).normalize('NFKC');
  for(let i=0;i<3;i++)title=title.replace(/\.(?:txt|srt|vtt|mp4)$/i, '').replace(/\s*\(\d+\)$/g, '');
  return title.replace(/__+/g, '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
}
export function matchTranscripts(videos, transcripts) {
  const matched = [], unmatched = [];
  const lessonTitle = file => {
    const raw=path.basename(file).normalize('NFKC').replace(/\.(?:mp4|txt|srt|vtt)$/i,'').replace(/\(\d+\)$/,'').replace(/^\s*(?:第)?\d+(?:节)?[\s_-]*/, '').replace(/[一二三四五六七八九十]+/g, value => {
    const digits='零一二三四五六七八九';
    if(value.includes('十')){const [a,b]=value.split('十');return String((a?digits.indexOf(a):1)*10+(b?digits.indexOf(b):0));}
    return String(digits.indexOf(value));
    });
    return {key:normalizedTitle(raw).replace(/(?:阅读)?练习(?:题)?/g,'练习'),numbers:raw.match(/\d+/g)||[]};
  };
  for (const transcript of transcripts) {
    let candidates = videos.filter(v => normalizedTitle(v.path) === normalizedTitle(transcript.path));
    if (!candidates.length && transcript.path.includes('视频转写稿')) {
      const number = Number(path.basename(transcript.path).match(/^\s*(\d+)/)?.[1]);
      candidates = videos.filter(v => v.number === number);
      const sameSubject = candidates.filter(v=>v.path.split(path.sep)[0]===transcript.path.split(path.sep)[0]);
      if(sameSubject.length)candidates=sameSubject;
      const title = lessonTitle(transcript.path);
      candidates = candidates.map(v => {
        const other = lessonTitle(v.path);
        const tokens = [...title.key];
        const numericMatch=title.numbers.every(n=>other.numbers.includes(n));
        return {...v, score: numericMatch&&tokens.length ? tokens.filter(c => other.key.includes(c)).length / tokens.length : 0};
      }).filter(v => v.score >= 0.55).sort((a,b) => b.score-a.score);
      if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
        const main = candidates.filter(v => v.pack === '上岸班2023_主体');
        candidates = main.length === 1 ? main : [];
      }
    }
    if (candidates.length === 1 || candidates.length > 1 && candidates[0].score > candidates[1].score) matched.push({transcript: transcript.path, video: candidates[0].path, pack: candidates[0].pack, number: candidates[0].number});
    else unmatched.push(transcript.path);
  }
  return {matched, unmatched};
}
function addCount(group, key, size) {
  const value = group[key] ||= {count: 0, bytes: 0}; value.count++; value.bytes += size;
}
function ranges(numbers) {
  const sorted = [...new Set(numbers.filter(Number.isFinite))].sort((a,b)=>a-b), groups=[];
  for (const n of sorted) { const group=groups.at(-1); if(group&&n===group[1]+1)group[1]=n;else groups.push([n,n]); }
  return groups.map(([a,b])=>a===b?String(a):`${a}–${b}`).join(', ') || '无';
}

export async function surveyRoot(root, {durations = false, tools = {}, onProgress = () => {}} = {}) {
  root = await fs.realpath(root);
  const started = Date.now(), before = await snapshot(root);
  const files = before.filter(e => e.kind === 'file' && !excluded(e.path));
  const result = {root, startedAt: new Date(started).toISOString(), files: files.length,
    bytes: files.reduce((sum,e)=>sum+e.size,0), extensions: {}, folders: {},
    pdf: {files: 0, pages: 0, textPages: 0, noTextPages: 0, failed: 0, items: []},
    pptx: {files: 0, slides: 0, withText: 0, failed: 0, items: []},
    word: {files: 0, readable: 0, failed: 0, items: []},
    archives: [], unsupported: [], videos: {total: 0, bytes: 0, durationSec: 0, durationKnown: 0, packs: {}, items: []},
    transcripts: {}, exclusions: {files: before.filter(e=>e.kind==='file'&&excluded(e.path)).length, rules:[...SKIP, '._*']}, timings: {pdfMs:0,pptxMs:0,wordMs:0,archiveMs:0,durationsMs:0}};
  const transcripts = [];
  let processed=0;
  const missing = command => {if (!tools[command]) throw new Error(`缺少工具 ${command}`);};
  const helper = async (mode, file) => {
    missing('python3');
    const {stdout} = await runTool('python3', [path.join(here,'survey-archive.py'), mode, file]);
    const data = JSON.parse(stdout); if (data.error) throw new Error(data.error); return data;
  };
  for (const entry of files) {
    const ext = path.extname(entry.path).toLowerCase(), file = path.join(root,entry.path);
    const statNow = await fs.lstat(file);
    if (statNow.isSymbolicLink() || !inside(root,await fs.realpath(file))) throw new Error('文件越界：'+entry.path);
    addCount(result.extensions, ext || '(无扩展名)', entry.size);
    addCount(result.folders, entry.path.split(path.sep).length>1?entry.path.split(path.sep)[0]:'(根目录)', entry.size);
    const tick=Date.now();
    if (ext === '.pdf') {
      result.pdf.files++;
      const item={path:entry.path};
      try {
        missing('pdftotext');
        const {stdout}=await runTool('pdftotext',['-enc','UTF-8',file,'-']);
        Object.assign(item,countPDFPages(stdout));
        if(tools.pdfinfo) {
          const info=(await runTool('pdfinfo',[file])).stdout;
          item.encrypted=/^Encrypted:\s+yes/im.test(info);
        }
        for (const key of ['pages','textPages','noTextPages']) result.pdf[key]+=item[key];
      } catch(error) {item.error=cleanError(error);result.pdf.failed++;}
      item.ms=Date.now()-tick;result.timings.pdfMs+=item.ms;result.pdf.items.push(item);
    } else if(ext === '.pptx') {
      result.pptx.files++;
      const item={path:entry.path};
      try {Object.assign(item,await helper('pptx',file));result.pptx.slides+=item.slides;result.pptx.withText+=item.withText;}
      catch(error){item.error=cleanError(error);result.pptx.failed++;}
      item.ms=Date.now()-tick;result.timings.pptxMs+=item.ms;result.pptx.items.push(item);
    } else if(DOCS.has(ext)) {
      result.word.files++;
      const item={path:entry.path};
      try {missing('textutil');const {stdout}=await runTool('textutil',['-convert','txt','-stdout',file]);item.chars=[...compact(stdout)].length;item.readable=item.chars>0;if(item.readable)result.word.readable++;else{result.word.failed++;item.error='没有读出文字';}}
      catch(error){item.readable=false;item.error=cleanError(error);result.word.failed++;}
      item.ms=Date.now()-tick;result.timings.wordMs+=item.ms;result.word.items.push(item);
    } else if(['.zip','.rar'].includes(ext)) {
      const item={path:entry.path};
      try{Object.assign(item,await helper(ext.slice(1),file));}catch(error){item.error=cleanError(error);}
      item.ms=Date.now()-tick;result.timings.archiveMs+=item.ms;result.archives.push(item);
    } else if(ext === '.ppt') result.unsupported.push({path:entry.path,reason:'老版 PowerPoint 格式（.ppt）读不出，可以另存为 PPTX 或 PDF'});
    if(ext === '.mp4') {
      const video={path:entry.path,size:entry.size,...videoInfo(entry.path)};
      result.videos.total++;result.videos.bytes+=entry.size;
      if(durations) {
        const start=Date.now();
        try{missing('ffprobe');const {stdout}=await runTool('ffprobe',['-v','error','-show_entries','format=duration','-of','json',file],{timeout:30000});const duration=Number(JSON.parse(stdout).format?.duration);if(!Number.isFinite(duration))throw new Error('未读出时长');video.durationSec=duration;result.videos.durationSec+=duration;result.videos.durationKnown++;}
        catch(error){video.error=cleanError(error);}
        result.timings.durationsMs+=Date.now()-start;
      }
      const pack=result.videos.packs[video.pack] ||= {total:0,bytes:0,durationSec:0,numbers:[],transcribed:[],missing:[]};
      pack.total++;pack.bytes+=entry.size;pack.durationSec+=video.durationSec||0;if(video.number!=null)pack.numbers.push(video.number);
      result.videos.items.push(video);
    }
    if(['.txt','.srt','.vtt'].includes(ext)) transcripts.push({path:entry.path});
    if(++processed%25===0) onProgress({root,processed,total:files.length,ms:Date.now()-started});
  }
  result.transcripts=matchTranscripts(result.videos.items,transcripts);
  result.transcripts.files=transcripts.length;
  result.transcripts.recognized=result.transcripts.matched.length;
  for (const [name,pack] of Object.entries(result.videos.packs)) {
    pack.transcribed=result.transcripts.matched.filter(m=>m.pack===name).map(m=>m.number);
    pack.missing=pack.numbers.filter(n=>!pack.transcribed.includes(n));
    pack.numberRanges=ranges(pack.numbers);pack.transcribedRanges=ranges(pack.transcribed);pack.missingRanges=ranges(pack.missing);
    pack.untranscribedDurationSec=result.videos.items.filter(v=>v.pack===name&&!result.transcripts.matched.some(m=>m.video===v.path)).reduce((n,v)=>n+(v.durationSec||0),0);
    pack.unnumbered=result.videos.items.filter(v=>v.pack===name&&v.number==null).map(v=>v.path);
    pack.missingFiles=result.videos.items.filter(v=>v.pack===name&&!result.transcripts.matched.some(m=>m.video===v.path)).map(v=>v.path);
  }
  const after=await snapshot(root);
  result.readOnly=compareSnapshots(before,after);
  result.readOnly.statement=result.readOnly.unchanged?'未写入：前后文件清单、大小和 mtime 完全一致（包含隐藏文件和 ._*）。':'检测到根目录变化，不能声明未写入，请核查差异。';
  result.ms=Date.now()-started;
  return result;
}
const md = value => String(value??'').replace(/\|/g,'\\|').replace(/\r?\n/g,' ');
const gb = bytes => (bytes/1e9).toFixed(3)+' GB';
export function markdown(report) {
  const lines=['# 讲义只读体检', '', `生成：${report.createdAt}；总耗时 ${(report.ms/1000).toFixed(1)} 秒。`, '',
    'PDF「无文字页」口径：pdftotext 输出按换页符分割，非空白字符少于 40；可能包括空白页。',
    '统计跳过 06_互动学习台、_整理记录、系统垃圾及 ._*；前后审计仍覆盖所有文件。视频只读元信息，不解码视频。', '', '## 本机工具', '', ...Object.entries(report.tools).map(([k,v])=>`- ${k}: ${Array.isArray(v)?v.join(', '):v}`)];
  for(const r of report.roots) {
    lines.push('',`## ${r.root}`, '', `${r.files} 个文件，${gb(r.bytes)}；耗时 ${(r.ms/1000).toFixed(1)} 秒。`, '',`**${r.readOnly.statement}**`,
      `前 ${r.readOnly.beforeEntries} / 后 ${r.readOnly.afterEntries} 项；SHA256 ${r.readOnly.beforeHash} / ${r.readOnly.afterHash}。`,
      '', '### 扩展名', '', '| 类型 | 文件 | 大小 |','|---|---:|---:|',...Object.entries(r.extensions).sort().map(([k,v])=>`| ${k} | ${v.count} | ${gb(v.bytes)} |`),
      '', '### 顶层目录', '', '| 目录 | 文件 | 大小 |','|---|---:|---:|',...Object.entries(r.folders).sort().map(([k,v])=>`| ${md(k)} | ${v.count} | ${gb(v.bytes)} |`),
      '', '### 文档', '', `- PDF：${r.pdf.files} 份，${r.pdf.pages} 页；有文字 ${r.pdf.textPages}，无文字 ${r.pdf.noTextPages}；失败 ${r.pdf.failed}。`,
      `- PPTX：${r.pptx.files} 份，${r.pptx.slides} 张，有字 ${r.pptx.withText} 张；失败 ${r.pptx.failed}。`,
      `- Word/RTF：${r.word.files} 份，可读 ${r.word.readable}，读不出 ${r.word.failed}。`,
      `- 分类耗时：${JSON.stringify(r.timings)}（毫秒）。`,
      '', '### 读不出的资料', '', ...[...r.pdf.items,...r.pptx.items,...r.word.items,...r.archives,...r.unsupported].filter(i=>i.error||i.reason).map(i=>`- ${md(i.path)}：${md(i.error||i.reason)}`),
      '', '### PDF 分文件页数', '', '| 文件 | 页 | 无文字页 |','|---|---:|---:|',...r.pdf.items.map(i=>`| ${md(i.path)} | ${i.pages??'?'} | ${i.noTextPages??'?'} |`),
      '', '### PPTX', '', '| 文件 | 张 | 有字 |','|---|---:|---:|',...r.pptx.items.map(i=>`| ${md(i.path)} | ${i.slides??'?'} | ${i.withText??'?'} |`),
      '', '### 压缩包（只列目录，不解压；非 UTF-8 ZIP 文件名按 GBK 解码）');
    for(const a of r.archives) lines.push('',`- ${md(a.path)}：${a.members?.length??'?'} 项；加密 ${a.encrypted??'未知'}${a.encryptionKnown===false?'（加密检测不可用）':''}。`,...(a.members||[]).map(m=>`  - ${md(m.path)}（${m.size} bytes${m.encrypted?'，加密':''}）`),...(a.errors||[]).map(e=>`  - 错误：${md(e)}`));
    lines.push('', '### 视频和转写覆盖', '', `视频 ${r.videos.total} 个，${gb(r.videos.bytes)}；已读时长 ${r.videos.durationKnown}/${r.videos.total}，共 ${(r.videos.durationSec/3600).toFixed(2)} 小时。`,
      `文本/字幕候选 ${r.transcripts.files} 份，匹配视频 ${r.transcripts.recognized} 份，未匹配 ${r.transcripts.unmatched.length} 份。`,
      '', '| 课包 | 视频 | 小时 | 编号 | 有转写 | 缺转写 | 缺转写小时 |','|---|---:|---:|---|---|---|---:|',...Object.entries(r.videos.packs).sort().map(([name,p])=>`| ${md(name)} | ${p.total} | ${(p.durationSec/3600).toFixed(2)} | ${p.numberRanges}（${p.unnumbered.length} 个无开头编号） | ${p.transcribedRanges} | ${p.missingRanges}（共 ${p.missingFiles.length} 个文件） | ${(p.untranscribedDurationSec/3600).toFixed(2)} |`));
    if(!r.readOnly.unchanged)lines.push('', '### 审计差异', '', '```json',JSON.stringify(r.readOnly,null,2),'```');
  }
  return lines.join('\n')+'\n';
}

export async function main(args=process.argv.slice(2)) {
  const roots=[];let durations=false,out;
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--root'&&args[i+1])roots.push(args[++i]);
    else if(args[i]==='--out'&&args[i+1])out=path.resolve(args[++i]);
    else if(args[i]==='--durations')durations=true;
    else throw new Error('用法：survey.mjs --root <目录> [--root …] [--durations] --out <json>');
  }
  if(!roots.length||!out)throw new Error('必须提供 --root 和 --out');
  const realRoots=await Promise.all(roots.map(r=>fs.realpath(r)));
  for(let a=0;a<realRoots.length;a++)for(let b=a+1;b<realRoots.length;b++)if(inside(realRoots[a],realRoots[b])||inside(realRoots[b],realRoots[a]))throw new Error('根目录不能重复或互相包含');
  // Resolve the nearest existing output ancestor so symlinked output directories
  // cannot send JSON, Markdown, temp files, or AppleDouble files onto the USB.
  const reportPath=out.replace(/\.json$/i,'')+'.md';
  for(const target of [out,reportPath]) {
    let ancestor=target,suffix=[];
    while(true){try{ancestor=await fs.realpath(ancestor);break;}catch(error){if(error.code!=='ENOENT')throw error;suffix.unshift(path.basename(ancestor));const parent=path.dirname(ancestor);if(parent===ancestor)throw error;ancestor=parent;}}
    const realTarget=path.join(ancestor,...suffix);
    if(realRoots.some(root=>inside(root,realTarget))||inside('/Volumes',realTarget))throw new Error('输出不能放进扫描根目录或任何 U 盘卷');
  }
  const started=Date.now(), tools=await toolStatus();
  const report={version:1,createdAt:new Date().toISOString(),durations,tools,roots:[]};
  for(const root of realRoots)report.roots.push(await surveyRoot(root,{durations,tools,onProgress:p=>process.stderr.write(`${p.root}: ${p.processed}/${p.total}，${(p.ms/1000).toFixed(0)} 秒\n`)}));
  report.ms=Date.now()-started;
  await fs.mkdir(path.dirname(out),{recursive:true});
  await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');
  await fs.writeFile(reportPath,markdown(report));
  process.stdout.write(`${out}\n${reportPath}\n${report.roots.map(r=>r.readOnly.statement).join('\n')}\n`);
  return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
