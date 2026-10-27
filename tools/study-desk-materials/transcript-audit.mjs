#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {snapshot,compareSnapshots} from './survey.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),report=JSON.parse(await fs.readFile(new URL('../../../briefs/study-desk-learn/survey-2026-10-26.json',import.meta.url),'utf8'));
const root=report.roots.find(r=>r.videos?.total),before=await snapshot(root.root),started=Date.now(),items=[];
for(const link of root.transcripts.matched){const file=await fs.realpath(path.join(root.root,link.transcript));if(!file.startsWith(root.root+path.sep))throw new Error('转写稿越界');const text=await fs.readFile(file,'utf8'),video=root.videos.items.find(v=>v.path===link.video),chars=[...text.replace(/\s/gu,'')].length;items.push({path:link.transcript,pack:link.pack,number:link.number,chars,charsPerMinute:chars/(video.durationSec/60),timeStamps:/\d{2}:\d{2}:\d{2}[.,]\d{3}/.test(text)});}
const audit=compareSnapshots(before,await snapshot(root.root)),result={createdAt:new Date().toISOString(),ms:Date.now()-started,files:items.length,characters:items.reduce((n,item)=>n+item.chars,0),meanCharsPerMinute:items.reduce((n,item)=>n+item.charsPerMinute,0)/items.length,minCharsPerMinute:Math.min(...items.map(item=>item.charsPerMinute)),maxCharsPerMinute:Math.max(...items.map(item=>item.charsPerMinute)),withTimeStamps:items.filter(item=>item.timeStamps).length,audit,items};
await fs.writeFile(path.join(here,'transcript-audit.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,items:undefined},null,2));if(!audit.unchanged)process.exitCode=1;
