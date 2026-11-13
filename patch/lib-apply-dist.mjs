// Shared CLI body for transform-only runtime patches: find the one dist file
// each transform recognises, back it up, write it. Fails loudly on ambiguity.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export function applyDist(root, label, steps) {
  const dist = path.join(root, 'dist');
  const files = fs.readdirSync(dist).filter(n => /\.m?js$/.test(n)).map(n => path.join(dist, n));
  const backup = process.env.PINKIE_PATCH_BACKUP_ROOT
    || path.join(os.homedir(), 'Library/Application Support/SuperPinkie/backups', `${label}-${Date.now()}`);
  const results = [];
  for (const transform of steps) {
    const hits = [];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      const r = transform(source);
      if (r.changed || r.reason === 'already-patched') hits.push([file, source, r]);
    }
    if (hits.length !== 1) throw new Error(`${label}: expected 1 matching runtime file, found ${hits.length}`);
    const [file, source, r] = hits[0];
    if (r.changed) {
      fs.mkdirSync(backup, {recursive: true, mode: 0o700});
      fs.copyFileSync(file, path.join(backup, path.basename(file)));
      fs.writeFileSync(file, r.text);
    }
    results.push({file: path.basename(file), reason: r.reason});
    void source;
  }
  return results;
}
