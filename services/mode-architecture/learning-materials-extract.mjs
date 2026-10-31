// Heavy parsing and tool execution live in nice-priority subprocesses.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const ARCHIVE_PY = "#!/usr/bin/env python3\n\"\"\"Read-only archive metadata. Never extracts a member or writes beside the source.\"\"\"\nimport ctypes\nimport ctypes.util\nimport json\nimport posixpath\nimport sys\nimport zipfile\nfrom xml.etree import ElementTree as ET\n\nMAX_XML = 8 * 1024 * 1024\n\ndef zip_name(info):\n    if info.flag_bits & 0x800:\n        return info.filename\n    raw = info.filename.encode('cp437')\n    for codec in ('utf-8', 'gbk', 'cp437'):\n        try:\n            return raw.decode(codec)\n        except UnicodeError:\n            pass\n    return info.filename\n\ndef xml(z, name):\n    entry = z.getinfo(name)\n    if entry.file_size > MAX_XML:\n        raise ValueError('XML member exceeds 8 MiB')\n    return ET.fromstring(z.read(entry))\n\ndef inspect_zip(file, mode):\n    with zipfile.ZipFile(file) as z:\n        if mode == 'pptx':\n            ns = {'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',\n                  'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}\n            rels = {r.attrib['Id']: r.attrib.get('Target', '') for r in xml(z, 'ppt/_rels/presentation.xml.rels')}\n            pages = []\n            for node in xml(z, 'ppt/presentation.xml').findall('.//p:sldId', ns):\n                target = rels[node.attrib['{' + ns['r'] + '}id']]\n                member = target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join('ppt', target))\n                page = xml(z, member)\n                texts = [e.text or '' for e in page.iter() if e.tag.endswith('}t')]\n                notes_chars = 0\n                rel_path = posixpath.join(posixpath.dirname(member), '_rels', posixpath.basename(member) + '.rels')\n                if rel_path in z.namelist():\n                    for rel in xml(z, rel_path):\n                        if rel.attrib.get('Type', '').endswith('/notesSlide'):\n                            note = posixpath.normpath(posixpath.join(posixpath.dirname(member), rel.attrib['Target']))\n                            notes_chars += sum(len(''.join((e.text or '').split())) for e in xml(z, note).iter() if e.tag.endswith('}t'))\n                pages.append({'n': len(pages)+1, 'chars': len(''.join(''.join(texts).split())), 'notesChars': notes_chars})\n            return {'slides': len(pages), 'withText': sum(p['chars'] > 0 for p in pages), 'pages': pages}\n        members = [{'path': zip_name(i), 'size': i.file_size, 'compressedBytes': i.compress_size,\n                    'encrypted': bool(i.flag_bits & 1), 'directory': i.is_dir()} for i in z.infolist()]\n        return {'members': members, 'encrypted': any(i['encrypted'] for i in members)}\n\ndef inspect_rar(file):\n    lib = ctypes.CDLL(ctypes.util.find_library('archive') or '/usr/lib/libarchive.2.dylib')\n    def fn(name, restype, argtypes):\n        f = getattr(lib, name); f.restype = restype; f.argtypes = argtypes; return f\n    ptr = ctypes.c_void_p\n    new = fn('archive_read_new', ptr, [])\n    support = fn('archive_read_support_format_all', ctypes.c_int, [ptr])\n    filters = fn('archive_read_support_filter_all', ctypes.c_int, [ptr])\n    opening = fn('archive_read_open_filename', ctypes.c_int, [ptr, ctypes.c_char_p, ctypes.c_size_t])\n    header = fn('archive_read_next_header', ctypes.c_int, [ptr, ctypes.POINTER(ptr)])\n    pathname = fn('archive_entry_pathname', ctypes.c_char_p, [ptr])\n    size = fn('archive_entry_size', ctypes.c_longlong, [ptr])\n    encrypted = fn('archive_entry_is_encrypted', ctypes.c_int, [ptr])\n    has_encrypted = fn('archive_read_has_encrypted_entries', ctypes.c_int, [ptr])\n    error = fn('archive_error_string', ctypes.c_char_p, [ptr])\n    free = fn('archive_read_free', ctypes.c_int, [ptr])\n    reader = new(); entry = ptr(); members = []; errors = []\n    try:\n        support(reader); filters(reader)\n        if opening(reader, file.encode(), 10240) < 0:\n            raise ValueError((error(reader) or b'archive open failed').decode('utf-8', 'replace'))\n        for _ in range(100000):\n            status = header(reader, ctypes.byref(entry))\n            if status == 1: break\n            if status < -20:\n                errors.append((error(reader) or b'archive header error').decode('utf-8', 'replace')); break\n            raw = pathname(entry) or b''\n            try: name = raw.decode('utf-8')\n            except UnicodeError: name = raw.decode('gbk', 'replace')\n            members.append({'path': name, 'size': size(entry), 'encrypted': encrypted(entry) > 0, 'directory': name.endswith('/')})\n        flag = has_encrypted(reader)\n        return {'members': members, 'encrypted': flag > 0 or any(m['encrypted'] for m in members),\n                'encryptionKnown': flag >= 0, 'errors': errors}\n    finally:\n        free(reader)\n\ntry:\n    mode, file = sys.argv[1:3]\n    result = inspect_rar(file) if mode == 'rar' else inspect_zip(file, mode)\n    print(json.dumps(result, ensure_ascii=False))\nexcept Exception as error:\n    print(json.dumps({'error': str(error)}, ensure_ascii=False))\n    sys.exit(1)\n";
export function runProcess(command,args,{signal,timeoutMs=120000,input,maxBytes=64*1024*1024,nice=15,binary=false,onData=null}={}) {
  return new Promise((resolve,reject)=>{
    const grouped=process.platform!=='win32'&&process.argv[2]!=='--extract';
    const child=spawn('nice',['-n',String(nice),command,...args],{detached:grouped,stdio:['pipe','pipe','pipe'],env:{...process.env,COPYFILE_DISABLE:'1'}});
    let bytes=0,errors='',chunks=[],failure,hardTimer;
    const kill=(signal='SIGTERM')=>{try{if(grouped&&child.pid)process.kill(-child.pid,signal);else child.kill(signal);}catch{}};
    const stop=()=>{failure ||= new Error(signal?.aborted?'任务已暂停':'处理超时');kill();if(!hardTimer){hardTimer=setTimeout(()=>kill('SIGKILL'),5000);hardTimer.unref?.();}};
    const timer=setTimeout(stop,timeoutMs);timer.unref?.();
    const onAbort=()=>stop();signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)stop();
    child.stdout.on('data',chunk=>{onData?.(chunk.toString('utf8'));bytes+=chunk.length;if(bytes>maxBytes){failure=new Error('文件解析输出过大');stop();}else chunks.push(chunk);});
    child.stderr.on('data',chunk=>{onData?.(chunk.toString('utf8'));if(errors.length<8000)errors+=chunk.toString('utf8');});
    child.on('error',error=>{failure=error;});
    child.on('close',code=>{clearTimeout(timer);clearTimeout(hardTimer);signal?.removeEventListener('abort',onAbort);if(failure||code!==0)reject(failure||new Error(errors.trim()||`工具 ${command} 退出 ${code}`));else{const value=Buffer.concat(chunks);resolve(binary?value:value.toString('utf8'));}});
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}
export async function detectTools(){
  const tools={};
  for(const command of ['pdftotext','pdftoppm','tesseract','ffmpeg','ffprobe','whisper-cli','textutil','bsdtar','python3']){
    tools[command]=false;for(const dir of (process.env.PATH||'').split(path.delimiter)){try{await fs.access(path.join(dir,command),1);tools[command]=true;break;}catch{}}
  }
  try{tools.whisperModel=(await fs.stat(path.join(os.homedir(),'models/whisper/ggml-medium.bin'))).isFile();}catch{tools.whisperModel=false;}tools.whisper=tools['whisper-cli']&&tools.whisperModel;return tools;
}
export async function archiveInfo(file,options={}){const metadata=JSON.parse(await runProcess('python3',['-c',ARCHIVE_PY,path.extname(file).toLowerCase()==='.rar'?'rar':'zip',file],options));if(!metadata.encrypted&&!metadata.error&&!metadata.errors?.length)await runProcess('bsdtar',[...(path.extname(file).toLowerCase()==='.zip'?['--options','zip:hdrcharset=CP936']:[]),'-tf',file],options);return metadata;}
export const EXTENSIONS=new Set(['.pdf','.pptx','.docx','.doc','.rtf','.ppt','.md','.txt','.srt','.vtt','.zip','.rar']);
export function decodeText(data){try{return new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{return new TextDecoder('gbk',{fatal:true}).decode(data);}}
export function chunks(text,size=1500){
  const result=[];for(const section of String(text).replace(/\r\n/g,'\n').split(/(?=^#{1,6}\s)/m)){let remaining=section.trim();while(remaining){let end=Math.min(size,remaining.length);if(end<remaining.length){const newline=remaining.lastIndexOf('\n',end);if(newline>size/2)end=newline;}result.push(remaining.slice(0,end).trim());remaining=remaining.slice(end).trim();}}
  return result.map((text,i)=>({loc:i+1,label:`第 ${i+1} 段`,text,method:'text'}));
}
const OFFICE_PY=String.raw`
import json,sys,zipfile,posixpath,os,subprocess
from xml.etree import ElementTree as ET
kind,file=sys.argv[1:3]
with zipfile.ZipFile(file) as z:
 def xml(name):
  i=z.getinfo(name)
  if i.file_size>8*1024*1024: raise ValueError('XML member too large')
  raw=subprocess.run(['bsdtar','-xOf',file,'--',name],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30,check=True).stdout if os.path.getsize(file)>50*1024*1024 else z.read(i)
  return ET.fromstring(raw)
 def texts(node): return ''.join(e.text or '' for e in node.iter() if e.tag.endswith('}t'))
 if kind=='docx':
  body=next(n for n in xml('word/document.xml').iter() if n.tag.endswith('}body'))
  lines=[]
  for child in body:
   if child.tag.endswith('}tbl'):
    for row in child:
     if row.tag.endswith('}tr'): lines.append(' | '.join(texts(cell) for cell in row if cell.tag.endswith('}tc')))
   elif child.tag.endswith('}p'): lines.append(texts(child))
  print(json.dumps({'text':'\n'.join(lines)},ensure_ascii=False))
 else:
  rels={r.attrib['Id']:r.attrib.get('Target','') for r in xml('ppt/_rels/presentation.xml.rels')}
  ns={'p':'http://schemas.openxmlformats.org/presentationml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
  pages=[]
  for node in xml('ppt/presentation.xml').findall('.//p:sldId',ns):
   target=rels[node.attrib['{'+ns['r']+'}id']]
   name=target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join('ppt',target))
   text='\n'.join(e.text or '' for e in xml(name).iter() if e.tag.endswith('}t'))
   rp=posixpath.join(posixpath.dirname(name),'_rels',posixpath.basename(name)+'.rels')
   if rp in z.namelist():
    for rel in xml(rp):
     if rel.attrib.get('Type','').endswith('/notesSlide'):
      note=posixpath.normpath(posixpath.join(posixpath.dirname(name),rel.attrib['Target']))
      text+='\n备注：\n'+'\n'.join(e.text or '' for e in xml(note).iter() if e.tag.endswith('}t'))
   pages.append({'loc':len(pages)+1,'label':'第 '+str(len(pages)+1)+' 张幻灯片','text':text,'method':'text'})
  print(json.dumps({'pages':pages},ensure_ascii=False))
`;
export function subtitlePages(text){
 const cues=[...String(text).replace(/\r/g,'').matchAll(/(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->[^\n]*\n([\s\S]*?)(?=\n\s*\n|$)/g)];
 if(!cues.length)return chunks(text,1200).map((page,i,list)=>({...page,label:`片段 ${i+1}/${list.length}`,method:'transcript'}));
 const pages=[];let group=null;
 for(const match of cues){const sec=Number(match[1]||0)*3600+Number(match[2])*60+Number(match[3])+Number(match[4])/1000;const content=match[5].replace(/<[^>]*>/g,'').trim();if(!group||group.text.length+content.length>1200){group={loc:pages.length+1,label:`${Math.floor(sec/60)}:${String(Math.floor(sec%60)).padStart(2,'0')}`,startSec:sec,text:'',method:'transcript'};pages.push(group);}group.text+=(group.text?'\n':'')+content;}
 return pages;
}
async function extractRaw(file,{signal}={}){
 const ext=path.extname(file).toLowerCase();
 if(ext==='.ppt')throw new Error('老版 PowerPoint 格式（.ppt）读不出，可以另存为 PPTX 或 PDF');
 if(ext==='.pdf'){
  const text=await runProcess('pdftotext',['-enc','UTF-8',file,'-'],{signal});const split=text.split('\f');if(split.length>1&&!split.at(-1).trim())split.pop();
  return split.map((text,i)=>({loc:i+1,label:`第 ${i+1} 页`,text,method:text.replace(/\s/g,'').length<40?'pending':'text'}));
 }
 if(ext==='.pptx'||ext==='.docx'){const value=JSON.parse(await runProcess('python3',['-c',OFFICE_PY,ext.slice(1),file],{signal}));return value.pages||chunks(value.text);}
 if(ext==='.doc'||ext==='.rtf'){try{const text=await runProcess('textutil',['-convert','txt','-stdout',file],{signal});if(!text.trim())throw new Error('empty');return chunks(text);}catch(error){if(signal?.aborted)throw error;throw new Error('老版 Word 格式读不出，可以另存为 DOCX 或 PDF');}}
 const stat=await fs.stat(file);if(stat.size>32*1024*1024)throw new Error('文字文件超过 32 MiB');
 const text=decodeText(await fs.readFile(file));return ['.srt','.vtt'].includes(ext)||file.includes('视频转写稿')?subtitlePages(text):chunks(text);
}
// The gateway receives already parsed chunks; filesystem reads/decoding and ZIP
// inflation occur in this separate Node process, never the gateway event loop.
export async function extractFile(file,options={}){
 return JSON.parse(await runProcess(process.execPath,[fileURLToPath(import.meta.url),'--extract',file],{...options,maxBytes:64*1024*1024}));
}
export async function archiveMember(file,member,tempRoot,{signal}={}){
 return withArchiveFile(file,member,tempRoot,target=>extractFile(target,{signal}),{signal});
}
export async function withArchiveFile(file,member,tempRoot,work,{signal}={}){
 if(!member||member.includes('\0')||path.posix.isAbsolute(member)||path.win32.isAbsolute(member)||member.split(/[\\/]/).includes('..'))throw new Error('压缩包成员路径越界');
 const directory=await fs.mkdtemp(path.join(tempRoot,'member-'));
 const target=path.join(directory,'source'+path.extname(member));
 try{const charset=path.extname(file).toLowerCase()==='.zip'?['--options','zip:hdrcharset=CP936']:[];const data=await runProcess('bsdtar',[...charset,'-xOf',file,'--',member],{signal,binary:true,maxBytes:64*1024*1024});await fs.writeFile(target,data);return await work(target);}
 finally{await fs.rm(directory,{recursive:true,force:true});}
}
// 不用顶层 await：OpenClaw 用 jiti 把插件转成 CommonJS 加载，顶层 await 会让整个插件加载失败。
if(process.argv[2]==='--extract')(async()=>{
 try{process.stdout.write(JSON.stringify(await extractRaw(process.argv[3])));}catch(error){process.stderr.write(error.message);process.exitCode=1;}
})();

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
  // 每个视频标题只规范化一次：163 份转写稿 × 875 个视频逐个重算要 300ms，会卡住网关。
  const videoKey = new Map(videos.map(v => [v, normalizedTitle(v.path)])), titles = new Map();
  const videoTitle = v => { if (!titles.has(v)) titles.set(v, lessonTitle(v.path)); return titles.get(v); };
  for (const transcript of transcripts) {
    const transcriptKey = normalizedTitle(transcript.path);
    let candidates = videos.filter(v => videoKey.get(v) === transcriptKey);
    if (!candidates.length && transcript.path.includes('视频转写稿')) {
      const number = Number(path.basename(transcript.path).match(/^\s*(\d+)/)?.[1]);
      candidates = videos.filter(v => v.number === number);
      const sameSubject = candidates.filter(v=>v.path.split(path.sep)[0]===transcript.path.split(path.sep)[0]);
      if(sameSubject.length)candidates=sameSubject;
      const title = lessonTitle(transcript.path);
      candidates = candidates.map(v => {
        const other = videoTitle(v);
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

export function videoChapters(video){
 const title=String(video.path||video.rel||video.title||'').normalize('NFKC'),n=video.number;
 if(/七选五|选词填空|完型|完形|改错|外省|地区真题|议论文|读写任务|二重积分|多元|级数|线性代数|行列式|矩阵|概率/.test(title))return [];
 if(title.startsWith('01_英语')||['上岸班2023_主体','冲刺班2024_主体','英语网课24_主体'].includes(video.pack)){
  if(video.pack==='上岸班2023_主体'&&n>=129&&n<=149)return [];
  if(/汉译英/.test(title))return ['e4'];if(/英译汉/.test(title))return ['e3'];if(/翻译/.test(title))return ['e3','e4'];if(/阅读|定位|细节|主旨|推断|论点|论据|练习题|阅读练习/.test(title))return ['e2'];
  if(/写作|书信|作文|写信|读写/.test(title))return ['e5'];if(/词|搭配|语法|时态|语态|从句|交际|虚拟|非谓语|名词|冠词|代词|形容词|副词|情态|介词|主谓|倒装|限定/.test(title))return ['e1'];
  if(video.pack==='上岸班2023_主体'){if(n<=48||n>=68&&n<=101)return ['e1'];if(n>=49&&n<=67||n>=150&&n<=169)return ['e2'];if(n>=102&&n<=119)return ['e5'];if(n>=120&&n<=124)return ['e3','e4'];if(n>=170)return ['e1'];}
 }else if(title.startsWith('02_高数')||video.pack==='主课程123讲'||video.pack?.startsWith('杰哥专升本')){
  if(/常微分|微分方程/.test(title))return ['m5'];if(/不定积分/.test(title))return ['m3'];if(/定积分/.test(title))return ['m4'];if(/积分/.test(title))return ['m3','m4'];if(/导数|微分/.test(title))return ['m2'];if(/函数|极限/.test(title))return ['m1'];
 }
 return [];
}
