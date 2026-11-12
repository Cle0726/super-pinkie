// 给模板自动造压力内容：long（每个字都写超）和 minimal（只填必填）。已有同名文件不覆盖。
// 用法：node tools/make-samples.mjs [模板目录…]（不写就处理全部）
import fs from 'node:fs';
import path from 'node:path';
import {listTemplates} from '../engine/catalog.mjs';

const LONG_TEXT = '这是一段故意写得特别特别长的测试文字用来检查版面会不会被撑破以及碧琪能不能收到删短的提示';
function stretch(value, max) {
  const base = String(value || LONG_TEXT).replace(/\*\*/g, '');
  const target = Math.max(Math.ceil((max || 12) * 1.8), base.length + 6);
  let s = base;
  while (s.length < target) s += LONG_TEXT;
  return s.slice(0, target);
}
const dirs = process.argv.slice(2).map(d => path.resolve(d));
for (const t of listTemplates().filter(t => !t.mine && (!dirs.length || dirs.includes(path.resolve(t.dir))))) {
  const ex = t.example || {};
  const long = {}, minimal = {};
  for (const [key, slot] of Object.entries(t.slots || {})) {
    if (slot.type === 'text') long[key] = stretch(ex[key], slot.max);
    if (slot.type === 'list') {
      const items = Array.isArray(ex[key]) && ex[key].length ? ex[key] : [{}];
      const n = (slot.maxItems || items.length) + 1;
      long[key] = Array.from({length: n}, (_, i) => {
        const it = items[i % items.length];
        if (typeof it !== 'object' || it === null) return stretch(it, slot.item?.text?.max);
        const o = {};
        for (const [f, spec] of Object.entries(slot.item || {})) o[f] = spec.type === 'image' ? it[f] : stretch(it[f], spec.max);
        return o;
      });
    }
    if (slot.type === 'image' && ex[key]) long[key] = ex[key];
    if (slot.required) minimal[key] = ex[key];
  }
  const sdir = path.join(t.dir, 'samples');
  fs.mkdirSync(sdir, {recursive: true});
  for (const [name, data] of [['long-auto', long], ['minimal-auto', minimal]]) {
    const file = path.join(sdir, `${name}.json`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  }
  console.log(`${t.id}: samples ok`);
}
