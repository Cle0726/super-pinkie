// 用某个仓库副本自己的截图工具，把 24 个场景截下来存到 outDir（不比对、不写基线）。
// node capture.mjs <repoRoot> <outDir>
import fs from 'node:fs'; import path from 'node:path'; import {pathToFileURL} from 'node:url';
const [root, out] = process.argv.slice(2);
const h = await import(pathToFileURL(path.join(root, 'tests/visual/lib/harness.mjs')).href);
fs.mkdirSync(out, {recursive: true});
const server = await h.startVisualServer();
let browser;
try {
  browser = await h.launchVisualBrowser();
  for (const scene of h.VISUAL_SCENES) for (const theme of h.THEMES) {
    const name = `${scene.id}-${theme}`;
    const {png, pageErrors} = await h.captureScenePng(browser, server.origin, scene.id, theme);
    fs.writeFileSync(path.join(out, name + '.png'), png);
    console.log(name, png.length, pageErrors.length ? 'pageErrors: ' + pageErrors.join('; ') : '');
  }
} finally { try { await browser?.close(); } catch {} try { await server.close(); } catch {} }
process.exit(0);
