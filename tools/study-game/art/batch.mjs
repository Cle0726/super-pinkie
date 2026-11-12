#!/usr/bin/env node
// 读 art-slots.json → 逐张调 gen.sh 出图 → 跳过已有（幂等）→ 日志进 art/study-game/logs/batch.log。
// 用法：node batch.mjs [--only=slot前缀,...] [--prio=1,2] [--jobs=2] [--redo=slot,...] [--dry]
import { readFileSync, existsSync, writeFileSync, appendFileSync, mkdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ART = process.env.STUDY_GAME_ART || '/Users/Admin/release-superpinkie/art/study-game';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const jobs = Math.min(4, Number(args.jobs || 2));
const only = args.only ? String(args.only).split(',') : null;
const prio = args.prio ? String(args.prio).split(',').map(Number) : null;
const redo = new Set(args.redo ? String(args.redo).split(',') : []);

const spec = JSON.parse(readFileSync(join(here, 'art-slots.json'), 'utf8'));
const T = spec.templates;

export function rawPath(slot) {
  return `${slot.slot}.png`;
}

export function buildPrompt(slot) {
  const tpl = T[slot.template];
  if (!tpl) throw new Error(`no template ${slot.template}`);
  return tpl.text.replaceAll('{desc}', slot.desc).replaceAll('{extra}', slot.extra || '');
}

function refsFor(slot) {
  const tpl = T[slot.template];
  const list = slot.refs || tpl.refs || [];
  return list.length ? list.map((r) => (r.startsWith('/') ? r : join(ART, r))).join(',') : '-';
}

const log = (m) => {
  const line = `${new Date().toISOString()} ${m}\n`;
  appendFileSync(join(ART, 'logs/batch.log'), line);
  process.stdout.write(line);
};

function run(slot) {
  return new Promise((resolve) => {
    const out = rawPath(slot);
    const pf = join(ART, 'logs', `${out.replaceAll('/', '__')}.prompt.txt`);
    writeFileSync(pf, buildPrompt(slot));
    const t0 = Date.now();
    const p = spawn('zsh', [join(here, 'gen.sh'), out, pf, refsFor(slot)], { stdio: 'ignore' });
    p.on('exit', (code) => {
      const ok = existsSync(join(ART, 'raw', out));
      log(`${ok ? 'OK ' : 'FAIL'} ${slot.slot} code=${code} ${Math.round((Date.now() - t0) / 1000)}s`);
      resolve(ok);
    });
  });
}

async function main() {
  mkdirSync(join(ART, 'logs'), { recursive: true });
  let todo = spec.slots.filter((s) => !s.skip);
  if (only) todo = todo.filter((s) => only.some((o) => s.slot.startsWith(o)));
  if (prio) todo = todo.filter((s) => prio.includes(s.prio));
  todo = todo.filter((s) => redo.has(s.slot) || !existsSync(join(ART, 'raw', rawPath(s))));
  todo.sort((a, b) => a.prio - b.prio);
  for (const s of redo) {
    const f = join(ART, 'raw', `${s}.png`);
    if (existsSync(f)) {
      const keep = join(ART, 'raw', `${s}.rej-${statSync(f).mtimeMs | 0}.png`);
      mkdirSync(dirname(keep), { recursive: true });
      writeFileSync(keep, readFileSync(f));
      writeFileSync(f, '');
      (await import('node:fs')).unlinkSync(f);
    }
  }
  log(`batch start ${todo.length} slots jobs=${jobs}`);
  if (args.dry) { todo.forEach((s) => console.log(s.prio, s.slot)); return; }
  const queue = [...todo];
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (queue.length) {
      const s = queue.shift();
      let ok = await run(s);
      if (!ok) ok = await run(s); // 一次重试（网络/超时）
    }
  }));
  log('batch done');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
