// node compare.mjs <repoRoot(for png-diff)> <dirA> <dirB> [diffOut]
import fs from 'node:fs'; import path from 'node:path'; import {pathToFileURL} from 'node:url';
const [root, a, b, diffOut] = process.argv.slice(2);
const {comparePng} = await import(pathToFileURL(path.join(root, 'tests/visual/lib/png-diff.mjs')).href);
if (diffOut) fs.mkdirSync(diffOut, {recursive: true});
for (const n of fs.readdirSync(a).filter((f) => f.endsWith('.png')).sort()) {
  const pb = path.join(b, n); if (!fs.existsSync(pb)) { console.log(n, 'MISSING in B'); continue; }
  const d = comparePng(fs.readFileSync(path.join(a, n)), fs.readFileSync(pb), {channelTolerance: 0});
  console.log(`${n.padEnd(34)} ${d.diffPercent.toFixed(4)}%  ${d.diffPixels}px`);
  if (diffOut && d.diffPixels && d.diffPngBuffer) fs.writeFileSync(path.join(diffOut, n.replace('.png', '-diff.png')), d.diffPngBuffer);
}
