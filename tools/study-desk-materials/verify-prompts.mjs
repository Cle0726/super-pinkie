#!/usr/bin/env node
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as lesson from '../../services/mode-architecture/learning-lesson.mjs';
import * as materials from '../../services/mode-architecture/learning-materials.mjs';
const file=process.argv[2]||new URL('../../../briefs/study-desk-learn/PROMPTS.md',import.meta.url),source=await fs.readFile(file,'utf8');
const split=source.split(/^## (P\d+) /m),sections=Object.fromEntries(Array.from({length:(split.length-1)/2},(_,i)=>[split[i*2+1],split[i*2+2]]));
for(const name of ['P1','P3','P4','P5','P6','P7','P8','P10']){
 const original=/```text\n([\s\S]*?)\n```/.exec(sections[name])?.[1],actual=lesson[name]??materials[name];assert.equal(actual,original,`${name} 必须与设计稿逐字一致`);console.log(name,createHash('sha256').update(actual).digest('hex'));
}
const p9=[...sections.P9.matchAll(/```text\n([\s\S]*?)\n```/g)].map(match=>match[1]);assert.deepEqual(Object.values(lesson.P9),p9);
assert.equal(lesson.P2_START,/- 开课：`([^`]+)`/.exec(sections.P2)[1]);assert.equal(lesson.P2_RESUME,/- 继续：`([^`]+)`/.exec(sections.P2)[1]);console.log('P2/P9 逐字一致；P1/P8 优先级在 learning-lesson.test.mjs 验证。');
