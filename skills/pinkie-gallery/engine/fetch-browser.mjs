// 后台下载自带的 Chromium（由 install.mjs 的 fetchBrowserInBackground 拉起，不占先生的时间）。
import fs from 'node:fs';
import path from 'node:path';
import {homePaths} from './paths.mjs';
import {ensureBrowser} from './install.mjs';

const task = process.argv[2] || '';
try { await ensureBrowser({task, quiet: true}); } catch {}
fs.rmSync(path.join(homePaths().browsers, '.fetching'), {force: true});
