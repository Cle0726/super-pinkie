import fs from 'node:fs';
import path from 'node:path';
import {readSessionJson, registerSessionMethod, writeSessionJson} from './session-titles.mjs';

// P1 project settings (PLAN §7, PROMPTS §6). Projects live in the sidebar as
// name → folder; sessions are bound to a folder by the project-scope plugin
// (<state>/project-scope/bindings.json, {root, name} per session key). The
// settings are keyed by the canonical folder, so renaming a project in the
// sidebar keeps them, and every session bound to that folder sees them.
export const MAX_INSTRUCTIONS = 8000;
export const MAX_PINNED = 20;
const SKIP_DIRS = new Set(['node_modules', '__pycache__', 'dist', 'build', '.git', 'venv', '.venv']);
const clip = (value, limit) => [...String(value ?? '')].slice(0, limit).join('');
const inside = (root, target) => target === root || target.startsWith(root + path.sep);
const real = dir => { try { return fs.realpathSync(dir); } catch { return ''; } };

export function projectPrompt(name, instructions, pinned = []) {
  const body = String(instructions || '').trim();
  const files = pinned.filter(Boolean);
  if (!body && !files.length) return '';
  const lines = [`【项目说明：${name || '这个项目'}】`, '这是用户为这个项目写的长期说明，在这个项目的每个会话里都适用：', body || '（没有写说明）'];
  if (files.length) lines.push('【常看资料】（只是路径，需要时再去读）', ...files.map(file => `- ${file}`));
  lines.push('【项目说明结束】');
  return lines.join('\n');
}

export class ProjectSettings {
  constructor(root, {bindingsFile}) {
    this.file = path.join(root, 'project-settings.json');
    this.bindingsFile = bindingsFile;
  }
  load() {
    let data = {};
    try { data = readSessionJson(this.file); } catch { data = {}; }
    return data.projects && typeof data.projects === 'object' ? data.projects : {};
  }
  bindings() { try { return readSessionJson(this.bindingsFile); } catch { return {}; } }
  // folder given → that folder; otherwise any session bound under this name.
  folderFor({name, folder}) {
    if (typeof folder === 'string' && path.isAbsolute(folder)) return real(folder) || path.resolve(folder);
    const wanted = String(name || '');
    for (const [root, entry] of Object.entries(this.load())) if (entry?.name === wanted) return root;
    for (const binding of Object.values(this.bindings())) if (binding?.name === wanted && binding.root) return binding.root;
    return '';
  }
  get(params = {}) {
    const folder = this.folderFor(params);
    const own = folder ? this.load()[folder] || {} : {};
    return {ok: true, name: String(params.name || own.name || ''), folder, instructions: own.instructions || '', pinned: Array.isArray(own.pinned) ? own.pinned : []};
  }
  set(params = {}) {
    const folder = this.folderFor(params);
    if (!folder) throw new Error('这个项目还没有文件夹，先给它选一个文件夹');
    const all = this.load();
    const own = {...(all[folder] || {})};
    own.name = clip(params.name || own.name || '', 80);
    if ('instructions' in params) {
      const text = String(params.instructions ?? '');
      if ([...text].length > MAX_INSTRUCTIONS) throw new Error(`项目说明最多 ${MAX_INSTRUCTIONS} 字`);
      own.instructions = text;
    }
    if ('pinned' in params) {
      if (!Array.isArray(params.pinned)) throw new Error('常看资料要是一组文件');
      const base = real(folder) || folder;
      const files = [];
      for (const raw of params.pinned) {
        const file = real(path.isAbsolute(String(raw)) ? String(raw) : path.join(base, String(raw)));
        if (!file || !inside(base, file)) throw new Error('常看资料只能从项目文件夹里选');
        try { if (!fs.statSync(file).isFile()) throw new Error(); } catch { throw new Error('常看资料只能选文件：' + path.basename(String(raw))); }
        if (!files.includes(file)) files.push(file);
      }
      if (files.length > MAX_PINNED) throw new Error(`常看资料最多 ${MAX_PINNED} 个`);
      own.pinned = files;
    }
    own.updatedAt = Date.now();
    all[folder] = own;
    writeSessionJson(this.file, {projects: all});
    return {ok: true};
  }
  // Files to choose 常看资料 from: a bounded walk of the project folder.
  files(params = {}) {
    const folder = this.folderFor(params);
    if (!folder) throw new Error('这个项目还没有文件夹');
    const base = real(folder) || folder;
    const needle = String(params.query || '').trim().toLowerCase();
    const out = [];
    let seen = 0;
    const walk = (dir, depth) => {
      if (depth > 6 || out.length >= 200 || seen > 20000) return;
      let entries = [];
      try { entries = fs.readdirSync(dir, {withFileTypes: true}); } catch { return; }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (out.length >= 200) return;
        seen += 1;
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, depth + 1);
        else if (entry.isFile()) {
          const rel = path.relative(base, full);
          if (!needle || rel.toLowerCase().includes(needle)) out.push({path: full, rel});
        }
      }
    };
    walk(base, 0);
    return {ok: true, folder: base, files: out};
  }
  promptFor(sessionKey) {
    const binding = this.bindings()[sessionKey];
    if (!binding?.root) return '';
    const own = this.load()[binding.root] || this.load()[real(binding.root)];
    if (!own) return '';
    return projectPrompt(own.name || binding.name, own.instructions, Array.isArray(own.pinned) ? own.pinned : []);
  }
}

export function registerProjectSettings(api, {root, bindingsFile}) {
  const settings = new ProjectSettings(root, {bindingsFile});
  const method = (name, fn) => registerSessionMethod(api, name, async params => {
    try { return await fn(params || {}); } catch (error) { return {ok: false, error: error.message}; }
  });
  method('pinkie.project.settings.get', params => settings.get(params));
  method('pinkie.project.settings.set', params => settings.set(params));
  method('pinkie.project.settings.files', params => settings.files(params));
  api.on?.('before_prompt_build', (event, ctx) => {
    try {
      const text = settings.promptFor(String(ctx?.sessionKey || ''));
      return text ? {appendSystemContext: `\n${text}\n`} : undefined;
    } catch { return undefined; }
  }, {priority: -10885});
  return settings;
}
