// 成品库用到的所有位置。自己的东西放在先生的用户目录里，不碰系统。
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

export const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function galleryHome(env = process.env) {
  if (env.PINKIE_GALLERY_HOME) return path.resolve(env.PINKIE_GALLERY_HOME);
  const home = os.homedir();
  if (process.platform === 'win32') {
    const base = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return path.join(base, 'SuperPinkie', 'gallery');
  }
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'SuperPinkie', 'gallery');
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'superpinkie', 'gallery');
}

export function homePaths(env = process.env) {
  const root = galleryHome(env);
  return {
    root,
    runtime: path.join(root, 'runtime'),          // 渲染要用的 npm 依赖（playwright-core、字体包、pptxgenjs……）
    browsers: path.join(root, 'browsers'),        // 下载的 Chromium
    brands: path.join(root, 'brands'),            // 先生的品牌套装
    mine: path.join(root, 'my-templates'),        // 先生自己存的模板，更新永远不碰
    cache: path.join(root, 'cache'),
    state: path.join(root, 'state.json'),
  };
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, {recursive: true});
  return dir;
}

// 和 personas/*/playbooks/downloads.mjs 同一个账本文件。
export function ledgerPath(env = process.env) {
  if (env.PINKIE_DOWNLOADS_LEDGER) return path.resolve(env.PINKIE_DOWNLOADS_LEDGER);
  const state = env.OPENCLAW_STATE_DIR ? path.resolve(env.OPENCLAW_STATE_DIR) : path.join(os.homedir(), '.openclaw');
  return path.join(state, 'pinkie', 'downloads.json');
}
