// 拿到一个能出图的浏览器。
// 1. 成品库自己下载的 Chromium（每台电脑一样）；
// 2. 还没下好时，先用电脑上的 Chrome / Edge 出图（字体都是成品库自带的，排版一样），同时在后台把自带内核下好；
// 3. 两样都没有，就现场下载（卡住会自动换源）。
import {homePaths} from './paths.mjs';
import {ensureBrowser, ensurePackages, fetchBrowserInBackground, importRuntime, shellInstalled} from './install.mjs';

let shared = null;
const ARGS = ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb'];

export async function getBrowser({task = '', quiet = false} = {}) {
  if (shared) return shared;
  const {browsers} = homePaths();
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
  await ensurePackages(['playwright-core'], {task, quiet});
  const pw = await importRuntime('playwright-core');
  const chromium = pw.chromium || pw.default?.chromium;
  const launch = async options => {
    const browser = await chromium.launch({headless: true, ...options, args: ARGS});
    browser.__pinkieSource = options.channel || 'own';
    return browser;
  };
  if (shellInstalled(browsers)) {
    try { return (shared = await launch({})); } catch {}
  }
  for (const channel of ['chrome', 'msedge']) {
    try {
      shared = await launch({channel});
      fetchBrowserInBackground({task});
      return shared;
    } catch {}
  }
  if (await ensureBrowser({task, quiet})) return (shared = await launch({}));
  throw new Error('没有能出图的浏览器：自带内核下载不下来（国内镜像和官方源都试过），电脑上也没有 Chrome / Edge');
}

export async function closeBrowser() {
  if (shared) { await shared.close().catch(() => {}); shared = null; }
}
