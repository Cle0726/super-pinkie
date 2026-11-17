import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {requestAppBrowser} from './app-browser.mjs';
import {trackBackgroundTask} from './background-jobs.mjs';

// 网页 GPT（后台）：用先生在碧琪内置浏览器里登录的 ChatGPT 账号，在 App 的隐藏页面里
// 提问或出图。不占用可见浏览器、不碰协作聊天；浏览器面板关着、App 被全屏应用挡住也照常跑。
// 网页同时只能处理一件事，所以这里排成一条队：提问插队到最前，出图一张张来。

const STATE = Symbol.for('pinkie.webGpt.v1');
const POLL_MS = 2_500;
const ASK_WAIT_MS = 4 * 60_000;
const SLOW_CALL_MS = 45_000;
const MAX_ITEMS = 60;
const MAX_COUNT = 4;
const SESSION_KEY = /^agent:(main|project|thinking|learning|unrestricted|metre):/;
const ASPECTS = {
  '竖': '竖版 9:16', '9:16': '竖版 9:16', '2:3': '竖版 2:3', '3:4': '竖版 3:4', '4:5': '竖版 4:5',
  '横': '横版 16:9', '16:9': '横版 16:9', '3:2': '横版 3:2', '4:3': '横版 4:3',
  '方': '正方形 1:1', '1:1': '正方形 1:1',
};
const LIMITED = /上限|限额|limit|稍后再试|try again later|too many/i;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function shared() {
  return globalThis[STATE] ||= {batches: new Map(), queue: [], running: false, conversations: new Map()};
}

function toolResult(value, isError = value?.ok === false) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return {content: [{type: 'text', text}], details: value, ...(isError ? {isError: true} : {})};
}

export function aspectLine(value) {
  const key = String(value || '').trim();
  if (!key) return '';
  return ASPECTS[key] || (/^\d{1,2}:\d{1,2}$/.test(key) ? key : '');
}

export function composeImagePrompt({prompt, style = '', aspect = ''}) {
  const parts = [];
  if (style) parts.push(String(style).trim());
  parts.push(String(prompt).trim());
  const ratio = aspectLine(aspect);
  if (ratio) parts.push(`画幅：${ratio}。`);
  parts.push('请直接生成图片，不用先确认或提问。');
  return parts.filter(Boolean).join('\n\n');
}

function safeName(value, fallback) {
  const cleaned = String(value || '').replace(/[\\/:*?"<>|\0\n\r\t]/g, '-').replace(/^\.+/, '').trim().slice(0, 80);
  return cleaned || fallback;
}

function insideHome(target, home) {
  const relative = path.relative(home, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
  const first = relative.split(path.sep)[0];
  // 不写进隐藏目录和 Library（碧琪自己的记忆、配置都在那里）。
  return !first.startsWith('.') && first !== 'Library';
}

// 出图放哪：先生给了绝对路径就用（只限用户目录里的普通文件夹）；给相对路径就放在当前绑定的项目里，
// 没绑定项目就放「文稿/碧琪出图」（「图片」不在看图工具允许的目录里，放那儿碧琪自己验不了图）。
// 碧琪自己的工作区不放用户的图。
export function resolveOutputDir({outDir = '', project = '', sessionKey = '', home = os.homedir(), date = new Date()} = {}) {
  const stamp = date.toISOString().slice(0, 10);
  const defaultRoot = project || path.join(home, 'Documents', String(sessionKey).startsWith('agent:metre:') ? 'Metre 出图' : '碧琪出图');
  const raw = String(outDir || '').trim();
  let target;
  if (!raw) target = project ? path.join(project, '出图', stamp) : path.join(defaultRoot, stamp);
  else if (raw === '~' || raw.startsWith('~/')) target = path.join(home, raw.slice(2));
  else if (path.isAbsolute(raw)) target = raw;
  else target = path.join(defaultRoot, raw);
  target = path.resolve(target);
  if (!insideHome(target, home)) throw new Error('出图文件夹必须在用户目录里的普通文件夹（不能是隐藏目录或 Library）。');
  return target;
}

// 批次里每项可以再分子文件夹（短剧按 角色/、第01集/分镜/ 这样分）。只收相对路径的普通段，不能跳出批次文件夹。
export function safeSubfolder(value) {
  const raw = String(value || '').trim().replace(/\\/g, '/');
  if (!raw) return '';
  if (raw.startsWith('/') || raw.startsWith('~') || /^[A-Za-z]:/.test(raw)) throw new Error(`folder 只能写相对路径：${raw}`);
  const parts = raw.split('/').map(part => part.trim()).filter(Boolean);
  if (parts.length > 4) throw new Error(`folder 最多 4 层：${raw}`);
  for (const part of parts) {
    if (part === '.' || part === '..' || part.startsWith('.') || /[:*?"<>|\0\n\r\t]/.test(part) || part.length > 60) {
      throw new Error(`folder 里有不能用的名字：${raw}`);
    }
  }
  return parts.join(path.sep);
}

// 聊天里给先生看图：回复末尾每张一行 MEDIA:/绝对路径（最多 6 张），会变成能预览、存到下载、在访达里显示的文件卡。
export function mediaLines(files = [], limit = 6) {
  return files.slice(0, limit).map(file => `MEDIA:${file}`).join('\n');
}

function uniqueFile(dir, base, ext) {
  let candidate = path.join(dir, `${base}${ext}`);
  for (let n = 2; fs.existsSync(candidate); n += 1) candidate = path.join(dir, `${base}-${n}${ext}`);
  return candidate;
}

// App 把图写在自己的临时目录里，这里只接受那个目录下的普通文件。
function movableSource(file) {
  const real = fs.realpathSync(file);
  if (!/[\\/]pinkie-gpt-web[\\/][0-9a-f-]{36}[\\/]image-\d+\.(png|jpe?g|webp)$/i.test(real)) throw new Error('App 返回的图片路径不对。');
  if (!fs.statSync(real).isFile()) throw new Error('App 返回的不是文件。');
  return real;
}

function deliverImage(file, dir, base) {
  const source = movableSource(file);
  const lower = path.extname(source).toLowerCase();
  const ext = lower === '.jpeg' ? '.jpg' : lower;
  fs.mkdirSync(dir, {recursive: true});
  const target = uniqueFile(dir, base, ext);
  fs.copyFileSync(source, target);
  // App 的临时文件是 0600；交给用户的图要和普通文件一样能被预览、上传。
  try { fs.chmodSync(target, 0o644); } catch {}
  try { fs.rmSync(path.dirname(source), {recursive: true, force: true}); } catch {}
  return target;
}

function resolveRefs(list = [], base = '') {
  return (Array.isArray(list) ? list : [list]).filter(Boolean).map(item => {
    const raw = String(item).trim();
    const abs = raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(2)) : path.isAbsolute(raw) ? raw : path.join(base || process.cwd(), raw);
    if (!fs.existsSync(abs)) throw new Error(`附图不存在：${raw}`);
    return path.resolve(abs);
  });
}

export class WebGptRunner {
  constructor({request = requestAppBrowser, pollMs = POLL_MS, track = trackBackgroundTask} = {}) {
    this.request = request;
    this.pollMs = pollMs;
    this.track = track;
    this.state = shared();
  }

  async call(action, params = {}) {
    // 第一次用时隐藏页要先把 chatgpt.com 加载出来（实测 11-17 超过 15 秒），查账号、开始任务多给点时间。
    const slow = action === 'gpt_web_account' || action === 'gpt_web_start';
    const reply = await this.request(action, params, slow ? {timeoutMs: SLOW_CALL_MS} : undefined);
    if (!reply?.ok) throw new Error(reply?.reason || '网页 GPT 操作失败');
    return reply.result || {};
  }

  // 一件事：发出去，等它做完。网页同一时间只做一件，所以调用方都经过 exclusive()。
  async runJob({kind, prompt, refs = [], conversationUrl = '', signal, onProgress}) {
    if (signal?.aborted) throw new Error('已取消');
    const started = await this.call('gpt_web_start', {kind, prompt, refs, ...(conversationUrl ? {conversationUrl} : {})});
    const job = started.job;
    for (;;) {
      if (signal?.aborted) {
        await this.call('gpt_web_cancel', {job}).catch(() => {});
        throw new Error('已取消');
      }
      await wait(this.pollMs);
      const status = await this.call('gpt_web_status', {job});
      onProgress?.(status);
      if (status.phase === 'done') return status;
      if (status.phase === 'failed') {
        const error = new Error(status.error || '网页 GPT 没有完成');
        error.limited = LIMITED.test(status.error || '');
        throw error;
      }
    }
  }

  exclusive(task, {front = false} = {}) {
    return new Promise((resolve, reject) => {
      const entry = {task, resolve, reject};
      if (front) this.state.queue.unshift(entry); else this.state.queue.push(entry);
      void this.drain();
    });
  }

  async drain() {
    if (this.state.running) return;
    this.state.running = true;
    try {
      while (this.state.queue.length) {
        const entry = this.state.queue.shift();
        try { entry.resolve(await entry.task()); } catch (error) { entry.reject(error); }
      }
    } finally { this.state.running = false; }
  }

  async account() {
    return this.call('gpt_web_account', {});
  }

  async ask({sessionKey, question, files = [], continueChat = false, signal}) {
    const conversationUrl = continueChat ? this.state.conversations.get(`ask:${sessionKey}`) || '' : '';
    const status = await this.exclusive(() => this.runJob({kind: 'ask', prompt: question, refs: files, conversationUrl, signal}), {front: true});
    if (status.conversationUrl) this.state.conversations.set(`ask:${sessionKey}`, status.conversationUrl);
    return status;
  }

  // 一批图：立刻返回批次号，后台一张张出；全部结束后叫醒碧琪。
  startBatch({sessionKey, items, style = '', aspect = '', refs = [], outDir, continueChat = false}) {
    const id = `img-${randomUUID().slice(0, 8)}`;
    const tasks = [];
    items.forEach((item, index) => {
      const count = Math.min(MAX_COUNT, Math.max(1, Number(item.count) || 1));
      const name = safeName(item.name, String(index + 1).padStart(2, '0'));
      const folder = safeSubfolder(item.folder);
      for (let n = 1; n <= count; n += 1) {
        tasks.push({
          name: count > 1 ? `${name}-${n}` : name,
          folder,
          prompt: composeImagePrompt({prompt: item.prompt, style, aspect: item.aspect || aspect}),
          refs: [...refs, ...(item.refs || [])].slice(0, 6),
          state: 'queued', files: [], error: '',
        });
      }
    });
    const batch = {id, sessionKey, outDir, tasks, startedAt: Date.now(), endedAt: 0, state: 'running', cancelled: false, controller: new AbortController(), conversationUrl: ''};
    this.state.batches.set(id, batch);
    fs.mkdirSync(outDir, {recursive: true});
    batch.watch = this.track({
      sessionKey,
      command: `网页 GPT 出图 ${tasks.length} 张 → ${outDir}`,
      isRunning: () => batch.state === 'running',
      wakeText: () => batchWakeText(batch),
    });
    void this.runBatch(batch, continueChat);
    return batch;
  }

  async runBatch(batch, continueChat) {
    for (const task of batch.tasks) {
      if (batch.cancelled) { task.state = 'cancelled'; continue; }
      task.state = 'running';
      let attempt = 0;
      for (;;) {
        attempt += 1;
        try {
          const status = await this.exclusive(() => this.runJob({
            kind: 'image', prompt: task.prompt, refs: task.refs,
            conversationUrl: continueChat ? batch.conversationUrl : '',
            signal: batch.controller.signal,
            onProgress: s => { task.detail = s.detail || s.phase; },
          }));
          if (continueChat && status.conversationUrl) batch.conversationUrl = status.conversationUrl;
          const dir = task.folder ? path.join(batch.outDir, task.folder) : batch.outDir;
          task.files = (status.files || []).map((file, i, all) =>
            deliverImage(file, dir, all.length > 1 ? `${task.name}-${String.fromCharCode(97 + i)}` : task.name));
          task.reply = String(status.reply || '').slice(0, 400);
          task.state = 'done';
          break;
        } catch (error) {
          task.error = error.message;
          if (batch.cancelled) { task.state = 'cancelled'; break; }
          if (error.limited) {
            // 额度到顶就停：剩下的不再一张张撞墙，叫醒碧琪说清楚。
            task.state = 'failed';
            batch.limited = true;
            batch.cancelled = true;
            break;
          }
          if (attempt >= 2) { task.state = 'failed'; break; }
          await wait(5_000);
        }
      }
    }
    batch.endedAt = Date.now();
    batch.state = batch.tasks.some(t => t.state === 'done') ? 'done' : 'failed';
    writeManifest(batch);
  }

  cancel(id) {
    const batch = this.state.batches.get(id);
    if (!batch) throw new Error('找不到这批图。');
    batch.cancelled = true;
    batch.controller.abort();
    return summary(batch);
  }

  status(sessionKey, id = '') {
    const list = [...this.state.batches.values()].filter(batch => batch.sessionKey === sessionKey && (!id || batch.id === id));
    return list.map(summary);
  }
}

function summary(batch) {
  const count = state => batch.tasks.filter(task => task.state === state).length;
  return {
    batch: batch.id, state: batch.state, outDir: batch.outDir,
    total: batch.tasks.length, done: count('done'), failed: count('failed'), queued: count('queued'), running: count('running'),
    limited: Boolean(batch.limited),
    current: batch.tasks.find(task => task.state === 'running')?.detail || '',
    files: batch.tasks.flatMap(task => task.files),
    folders: [...new Set(batch.tasks.filter(task => task.folder && task.files.length).map(task => path.join(batch.outDir, task.folder)))],
    errors: batch.tasks.filter(task => task.error && task.state !== 'done').map(task => `${task.name}：${task.error}`).slice(0, 10),
  };
}

function writeManifest(batch) {
  try {
    const manifest = {
      batch: batch.id, startedAt: new Date(batch.startedAt).toISOString(), endedAt: new Date(batch.endedAt).toISOString(),
      source: '网页 ChatGPT（碧琪内置浏览器登录的账号）',
      images: batch.tasks.map(({name, folder, prompt, refs, state, files, error}) => ({name, ...(folder ? {folder} : {}), prompt, refs, state, files: files.map(file => path.relative(batch.outDir, file)), ...(error ? {error} : {})})),
    };
    fs.writeFileSync(path.join(batch.outDir, `出图记录-${batch.id}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  } catch {}
}

export function batchWakeText(batch) {
  const s = summary(batch);
  const minutes = Math.max(1, Math.round(((batch.endedAt || Date.now()) - batch.startedAt) / 60_000));
  return `[pinkie-tier] 后台任务完成：网页 GPT 出图批次 ${s.batch} 已结束（约 ${minutes} 分钟）：成功 ${s.done} 张，失败 ${s.failed} 张，`
    + `${s.limited ? '中途 ChatGPT 提示出图次数到上限，剩下的已停下；' : ''}文件在 ${s.outDir}。`
    + (s.errors.length ? `失败原因：${s.errors.join('；')}。` : '')
    + '先打开几张原图亲眼看（手指、脸、文字、logo、角色是否一致）；当前模型看不了图时，用 web_gpt action=ask 把图放进 files 请网页 GPT 逐张检查。多张时拼对比表给用户挑；'
    + '有瑕疵的用 web_gpt 重出那几张；然后把真实结果告诉用户：说清图放在哪个文件夹（分了子文件夹就逐个列出），'
    + '回复末尾每张一行 MEDIA:/绝对路径把图发到聊天里给用户看（最多 6 张，多了挑代表性的，其余说在文件夹里）。'
    + (s.files.length ? `可直接用的 MEDIA 行：\n${mediaLines(s.files)}\n` : '')
    + '这条消息由系统自动发出，用户看不到，回复里不要提到它。';
}

const DESCRIPTION = [
  '网页 GPT（后台）：用先生在碧琪内置浏览器里登录的 ChatGPT 账号做事，App 在隐藏页面里完成，不打扰先生，浏览器面板关着、先生在全屏干别的也能用。',
  'action=account：看有没有登录、什么套餐。没登录就请先生在碧琪的浏览器里打开 chatgpt.com 登录，碧琪不能代登。',
  'action=ask：把一个问题交给网页 ChatGPT，等它答完返回全文（一般几十秒，最多约 4 分钟）。适合：当前模型偏弱或拿不准的难题、要第二意见、要 ChatGPT 看图（files 附图）。continue=true 接着本会话上一次的网页对话追问。',
  '回答只是参考资料：要自己核对，不能替代本地读文件、跑测试；不要把先生的隐私、密钥、记忆发过去。',
  'action=image：批量出图，立刻返回批次号，后台一张张出、下载到 out_dir（相对路径放在当前项目或「文稿/碧琪出图」下），全部结束会自动叫醒碧琪去验图；当前模型看不了图时，用 ask 附图请网页 GPT 帮忙验。',
  'items 每项 {prompt, name?, folder?, refs?, count?, aspect?}；folder 把这张放进 out_dir 下的子文件夹，AI 短剧这类项目按 角色/、场景/、第01集/分镜/ 分好，先生好管理；style 是每张都加的统一画风；refs 是每张都带的参考图（角色定稿、商品原图，锁一致性靠它）；aspect 竖/横/方 或 9:16 这类；continue=true 让整批在同一个网页对话里出（连续改图、同一角色多场景）。',
  '给先生看图：回复末尾每张一行 MEDIA:/绝对路径（最多 6 张），聊天里会变成能预览、存到下载、在访达里显示的图片卡；不要只报路径。',
  '一次最多 60 项，每项最多 4 张。发出后别干等：去做别的事或告诉先生在后台出图。action=status 看进度，action=cancel 停掉一批。',
  '先生的 Plus 账号出图基本不限量；真碰到上限会停下并告诉你，不要充值或换号。',
].join('\n');

export function createWebGptTool(ctx = {}, {runner = new WebGptRunner(), projectFor = () => ''} = {}) {
  const sessionKey = String(ctx.sessionKey || '');
  return {
    name: 'web_gpt',
    label: '网页 GPT',
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {type: 'string', enum: ['account', 'ask', 'image', 'status', 'cancel']},
        question: {type: 'string', description: 'ask：要问的完整内容（自己把需要的背景写进去，网页 GPT 看不到这里的对话）'},
        files: {type: 'array', items: {type: 'string'}, maxItems: 6, description: 'ask：附带的图片路径'},
        items: {
          type: 'array', maxItems: MAX_ITEMS,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              prompt: {type: 'string'}, name: {type: 'string', description: '文件名（不带扩展名）'},
              refs: {type: 'array', items: {type: 'string'}, maxItems: 6}, count: {type: 'integer', minimum: 1, maximum: MAX_COUNT},
              aspect: {type: 'string'},
              folder: {type: 'string', description: '放进 out_dir 下的子文件夹（相对路径，如 角色 或 第01集/分镜）'},
            },
            required: ['prompt'],
          },
        },
        style: {type: 'string'},
        refs: {type: 'array', items: {type: 'string'}, maxItems: 6},
        aspect: {type: 'string'},
        out_dir: {type: 'string', description: '出图文件夹：相对路径放在当前项目里（如 第01集），不写就是 出图/日期'},
        continue: {type: 'boolean'},
        batch: {type: 'string', description: 'status / cancel：批次号'},
      },
      required: ['action'],
    },
    async execute(_toolCallId, params = {}, signal) {
      try {
        if (!SESSION_KEY.test(sessionKey)) throw new Error('缺少当前会话。');
        const project = (() => { try { return projectFor(sessionKey) || ''; } catch { return ''; } })();
        switch (params.action) {
          case 'account': {
            const account = await runner.account();
            return toolResult({ok: true, ...account, hint: account.loggedIn ? '' : '请先生在碧琪的浏览器里打开 chatgpt.com 登录。'});
          }
          case 'ask': {
            const question = String(params.question || '').trim();
            if (!question) throw new Error('ask 要写 question。');
            const files = resolveRefs(params.files, project || ctx.workspaceDir);
            const timeout = AbortSignal.timeout(ASK_WAIT_MS);
            const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
            const status = await runner.ask({sessionKey, question, files, continueChat: params.continue === true, signal: combined});
            const reply = String(status.reply || '');
            // 回答里带的图也存下来（App 的临时目录会被清掉，聊天里也显示不了那里的图）。
            let images = [];
            if (status.files?.length) {
              const dir = resolveOutputDir({outDir: params.out_dir, project, sessionKey});
              images = status.files.flatMap((file, i) => {
                try { return [deliverImage(file, dir, `网页GPT回答-${Date.now().toString(36)}-${i + 1}`)]; } catch { return []; }
              });
            }
            return toolResult({
              ok: true,
              source: '网页 ChatGPT 的回答（参考资料，需自己核对）',
              reply,
              ...(images.length ? {images, show: `要给先生看就在回复末尾逐行写：\n${mediaLines(images)}`} : {}),
            });
          }
          case 'image': {
            const items = Array.isArray(params.items) ? params.items.filter(item => String(item?.prompt || '').trim()) : [];
            if (!items.length) throw new Error('image 要给 items（至少一项 prompt）。');
            if (items.length > MAX_ITEMS) throw new Error(`一批最多 ${MAX_ITEMS} 项，分几批发。`);
            const base = project || ctx.workspaceDir;
            const refs = resolveRefs(params.refs, base);
            const normalized = items.map(item => ({...item, refs: resolveRefs(item.refs, base)}));
            const outDir = resolveOutputDir({outDir: params.out_dir, project, sessionKey});
            const batch = runner.startBatch({sessionKey, items: normalized, style: params.style, aspect: params.aspect, refs, outDir, continueChat: params.continue === true});
            return toolResult({
              ok: true, batch: batch.id, total: batch.tasks.length, outDir,
              ...(normalized.some(item => item.folder) ? {folders: [...new Set(normalized.filter(item => item.folder).map(item => path.join(outDir, safeSubfolder(item.folder))))]} : {}),
              note: '已在后台排队出图，全部结束会自动叫醒你。现在去做不依赖这些图的事，或告诉先生图在后台出、大概每张一两分钟。',
            });
          }
          case 'status':
            return toolResult({ok: true, batches: runner.status(sessionKey, params.batch)});
          case 'cancel':
            if (!params.batch) throw new Error('cancel 要给 batch。');
            return toolResult({ok: true, ...runner.cancel(String(params.batch))});
          default:
            throw new Error('action 只能是 account / ask / image / status / cancel。');
        }
      } catch (error) {
        return toolResult({ok: false, error: error instanceof Error ? error.message : String(error)}, true);
      }
    },
  };
}
