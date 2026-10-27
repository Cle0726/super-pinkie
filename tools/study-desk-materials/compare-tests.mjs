import fs from 'node:fs/promises';
const baseline=JSON.parse(await fs.readFile(new URL('./baseline-failures.json',import.meta.url),'utf8'));
const log=await fs.readFile(new URL('./final-suite.tap',import.meta.url),'utf8'),current=[...log.matchAll(/^not ok \d+ - (.+)$/gm)].map(match=>match[1]);
const summary={baseline:baseline.length,current:current.length,added:current.filter(name=>!baseline.includes(name)),removed:baseline.filter(name=>!current.includes(name)),counts:Object.fromEntries([...log.matchAll(/^# (tests|pass|fail|skipped|duration_ms) ([\d.]+)$/gm)].map(match=>[match[1],Number(match[2])]))};
await fs.writeFile(new URL('./test-comparison.json',import.meta.url),JSON.stringify(summary,null,2)+'\n');console.log(summary);
