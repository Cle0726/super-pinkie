import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

// 飞书存活补丁与 QQ 配对适配器共用的「校验原包 → 写前全检 → 备份 + 临时文件 → 失败回滚」流程。
// 各自的报错文案原样保留，由 spec 传入：
//   name / version  已校验的发布包名与版本
//   requirement     包名或版本不对时的报错
//   publisher       「<publisher> publisher ...」里的平台名（Feishu / QQ）
//   patch           「<patch> backup changed / temporary file already exists」里的补丁名
//   hashLabel       「<hashLabel> hash mismatch」里的补丁名
//   preflight       「<publisher> publisher changed during <preflight> preflight」里的阶段名
//   baselines       相对路径 → 原包 SHA-256
//   patched         相对路径 → 改后 SHA-256
//   transforms      相对路径 → (原文) => 改后原文
export const sha256 = source => createHash('sha256').update(source).digest('hex');

export function planPublisherPatch(root, spec) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (pkg.name !== spec.name || pkg.version !== spec.version) throw new Error(spec.requirement);
  const plan = Object.entries(spec.baselines).map(([relative, baseline]) => {
    const file = path.join(root, relative);
    if (!fs.lstatSync(file).isFile()) throw new Error(`${spec.publisher} publisher target must be a regular file: ${relative}`);
    const source = fs.readFileSync(file, 'utf8'), digest = sha256(source);
    if (digest !== baseline && digest !== spec.patched[relative]) throw new Error(`${spec.publisher} publisher file changed: ${relative}; nothing was written`);
    const next = digest === baseline ? spec.transforms[relative](source) : source;
    if (sha256(next) !== spec.patched[relative]) throw new Error(`${spec.hashLabel} hash mismatch: ${relative}; nothing was written`);
    return {file, relative, source, next, mode: fs.statSync(file).mode & 0o777};
  });
  // Check every original backup and temporary destination before the first write.
  for (const item of plan) {
    const backup = `${item.file}.pinkie-original`, temporary = `${item.file}.pinkie-tmp`;
    if (fs.existsSync(backup) && (!fs.lstatSync(backup).isFile() || sha256(fs.readFileSync(backup)) !== spec.baselines[item.relative])) {
      throw new Error(`${spec.patch} backup changed: ${item.relative}; nothing was written`);
    }
    if (fs.existsSync(temporary)) throw new Error(`${spec.patch} temporary file already exists: ${item.relative}; nothing was written`);
  }
  return plan;
}

export function applyPublisherPatch(root, spec) {
  const plan = planPublisherPatch(root, spec);
  const changed = plan.filter(item => item.source !== item.next);
  // Avoid overwriting a publisher file modified since preflight.
  for (const item of plan) if (fs.readFileSync(item.file, 'utf8') !== item.source) throw new Error(`${spec.publisher} publisher changed during ${spec.preflight} preflight; nothing was written`);
  const written = [], backups = [], temporary = [];
  try {
    for (const item of changed) {
      const backup = `${item.file}.pinkie-original`, temp = `${item.file}.pinkie-tmp`;
      if (!fs.existsSync(backup)) {
        fs.writeFileSync(backup, item.source, {flag: 'wx', mode: item.mode}); backups.push(backup);
      }
      fs.writeFileSync(temp, item.next, {flag: 'wx', mode: item.mode}); temporary.push(temp);
    }
    for (const item of changed) {
      fs.renameSync(`${item.file}.pinkie-tmp`, item.file); written.push(item);
    }
  } catch (error) {
    for (const item of written) fs.writeFileSync(item.file, item.source, {mode: item.mode});
    for (const file of temporary) fs.rmSync(file, {force: true});
    for (const file of backups) fs.rmSync(file, {force: true});
    throw error;
  }
  return plan.map(item => ({file: item.file, changed: item.source !== item.next, sha256: sha256(item.next)}));
}
