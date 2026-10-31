#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {videoChapters} from '../../services/mode-architecture/learning-materials-extract.mjs';
const input=process.argv[2]||new URL('../../../briefs/study-desk-learn/survey-2026-10-26.json',import.meta.url);
const out=path.join(path.dirname(fileURLToPath(import.meta.url)),'video-map.json');
const report=JSON.parse(await fs.readFile(input,'utf8'));
const videos=report.roots.flatMap(root=>root.videos.items.map(video=>({root:root.root,path:video.path,pack:video.pack,number:video.number,title:video.title,durationSec:video.durationSec||null,chapters:videoChapters(video),scope:videoChapters(video).length?'syllabus':'other'})));
await fs.writeFile(out,JSON.stringify({generatedAt:new Date().toISOString(),source:'资料地图.md 的主课包编号范围，加上目录/标题的保守规则；无把握和不考内容标 other，人工验收可重新生成。',videos},null,2)+'\n');
console.log(`${videos.length} videos -> ${out}`);
