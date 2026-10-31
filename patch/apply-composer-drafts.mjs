/** Keep the native per-session draft store, with immediate saves and no draft eviction. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {refreshPrecompressed} from './lib-precompressed.mjs';

const marker = '/* pinkie-composer-drafts:v4 */';
const previousMarker = '/* pinkie-composer-drafts:v1 */';
function refreshCache(url) {
  const [file,query='']=url.split('?'),params=new URLSearchParams(query);
  params.set('pinkie-drafts','4');return file+'?'+params;
}

export function pinkieComposerReadOnly(state) {
  const doc = globalThis.document;
  // Native internal splits are several panes inside one WebView. Only the
  // primary pane owns the composer; independent mode documents remain writable.
  const panes = Array.from(doc?.querySelectorAll?.('openclaw-chat-pane') || []);
  const own = panes.find(pane => pane.state === state);
  if (own && globalThis.__pinkieReadingViews) return globalThis.__pinkieReadingViews.isReading(own);
  return Boolean(own && panes.length > 1 && own !== panes[0]);
}

// 2026.7 imports its composer store from sessionStorage despite the native
// persistence API's name. Mirror text only, per gateway/session, to durable
// storage. Queued sends retain their original lifecycle and are never replayed
// merely because this text backup survived an App restart.
export function pinkieDurableComposerStore(native, session, state) {
  const prefix = 'pinkie.composerDraft.v2:';
  const keyFor = key => prefix + key + ':' + encodeURIComponent(session);
  const readOnly = () => pinkieComposerReadOnly(state);
  const local = () => { try { return globalThis.localStorage; } catch { return null; } };
  const parse = value => { try { return JSON.parse(value || 'null'); } catch { return null; } };
  return {
    getItem(key) {
      let raw; try { raw = native?.getItem(key); } catch {}
      const saved = parse(local()?.getItem(keyFor(key)));
      if (!saved || typeof saved.draft !== 'string' || !saved.draft) return raw ?? null;
      const data = parse(raw), store = data?.version === 1 && data.sessions && !Array.isArray(data.sessions)
        ? data : {version:1,sessions:{}};
      const entry = store.sessions[session];
      if (!entry || Number(saved.updatedAt) >= Number(entry.updatedAt || 0)) {
        store.sessions[session] = {...entry,draft:saved.draft,updatedAt:saved.updatedAt};
      }
      return JSON.stringify(store);
    },
    setItem(key, value) {
      if (readOnly()) return;
      try { native?.setItem(key,value); } catch {}
      const entry = parse(value)?.sessions?.[session], storage = local();
      if (!storage) return;
      if (typeof entry?.draft === 'string' && entry.draft) {
        const old = parse(storage.getItem(keyFor(key)));
        if (old?.draft !== entry.draft) storage.setItem(keyFor(key),JSON.stringify({draft:entry.draft,updatedAt:entry.updatedAt || Date.now()}));
      } else storage.removeItem(keyFor(key));
    },
    removeItem(key) {
      if (readOnly()) return;
      try { native?.removeItem(key); } catch {}
      local()?.removeItem(keyFor(key));
    },
  };
}

function pinkieCaptureComposerInput(gatewayKey, sessionKey) {
  if (globalThis.__pinkieDurableComposerInput || !globalThis.document?.querySelectorAll) return;
  globalThis.__pinkieDurableComposerInput = true;
  document.addEventListener('input', event => {
    const textarea = event.target?.closest?.('.agent-chat__composer-combobox textarea');
    const owner = textarea?.closest?.('openclaw-chat-pane');
    const state = owner?.state || (document.documentElement?.hasAttribute?.('data-laolao-startup-home') ? document.querySelector('openclaw-chat-pane')?.state : null);
    if (!state?.sessionKey || typeof textarea.value !== 'string' || pinkieComposerReadOnly(state)) return;
    try {
      const key = 'pinkie.composerDraft.v2:' + gatewayKey(state.settings?.gatewayUrl) + ':' + encodeURIComponent(sessionKey(state,state.sessionKey));
      if (textarea.value) localStorage.setItem(key,JSON.stringify({draft:textarea.value,updatedAt:Date.now()}));
      else localStorage.removeItem(key);
    } catch { /* Native store remains available when persistent storage is full. */ }
  },true);
}

function withDurableLegacyDrafts(source) {
  if (!source.includes('openclaw.control.chatComposer.v1:')) return source;
  const load = /function (\w+)\((\w+),(\w+)\)\{let (\w+)=(\w+)\(\);if\(!\4\)return null;try\{let (\w+)=(\w+)\(\2.settings\?\.gatewayUrl\),(\w+)=(\w+)\(\2,\3\),/u.exec(source);
  if (!load) throw new Error('原生草稿读取结构已变化，未添加持久备份');
  const accessor = load[5], gatewayKey = load[7], sessionKey = load[9];
  const pattern = new RegExp('function (\\w+)\\((\\w+),(\\w+)([^)]*)\\)\\{let (\\w+)='+accessor+'\\(\\);','g');
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 4) throw new Error('草稿存储边界不明确，未覆盖');
  const patched = source.replace(pattern,(_all,name,state,session,tail,storage) =>
    `function ${name}(${state},${session}${tail}){let ${storage}=pinkieDurableComposerStore(${accessor}(),${sessionKey}(${state},${session}??${state}.sessionKey),${state});`);
  return pinkieComposerReadOnly.toString()+'\n'+pinkieDurableComposerStore.toString()+'\n'+pinkieCaptureComposerInput.toString()+`\npinkieCaptureComposerInput(${gatewayKey},${sessionKey});\n`+patched;
}

function replaceOne(source, pattern, replacement) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error('原生草稿保存结构已变化，未覆盖：' + pattern.source.slice(0, 70));
  return source.replace(pattern, replacement);
}

// A fresh RegExp per call: a `g` pattern keeps lastIndex between test()/exec().
function replaceOptional(source, pattern, replacement) {
  pattern = new RegExp(pattern.source, pattern.flags);
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) return {source, applied: false};
  return {source: source.replace(pattern, replacement), applied: true};
}

// The native store comes in two shapes:
//   2026.7  — localStorage, `lastPersisted`, a count-bounded session map.
//   2026.10 — `pending` snapshots backed by a durable IndexedDB mirror and
//             revision fences.
// Only the change-detection guard and the page-suspension flush are injected;
// native restore, revision and durable-write logic always stays intact.
const LEGACY_PERSIST = /persistChangedState\(\)\{let (\w+)=this\.getState\(\);this\.lastPersisted\?\.chatQueue!==\1\?\.chatQueue&&this\.persistNow\(\)\}/g;
const CURRENT_PERSIST = /persistChangedState\(\)\{this\.pending&&this\.persistNow\(\),this\.synchronizeDurablePersistence\(\),this\.persistNow\(\)\}/g;
const LEGACY_START = /start\(\)\{let (\w+)=this\.getState\(\);\1&&\(this\.ready=!0,this\.lastPersisted=this\.snapshot\(\1\)\)\}/g;
const CURRENT_START = /start\(\)\{let (\w+)=this\.getState\(\);if\(!\1\)return;this\.ready=!0,this\.pending=null;/g;
const LEGACY_STOP = /stop\(\)\{this\.persistNow\(\),this\.ready=!1,this\.clearTimer\(\)\}/g;
const CURRENT_STOP = /stop\(\)\{this\.persistNow\(\),this\.ready=!1,this\.pending=null,this\.clearTimer\(\)\}/g;

// Installed once per store instance (each snippet starts with `;` so it is
// safe after both the `}` and the `…;` native endings). The callback must stay synchronous:
// Safari tears the page down as soon as it returns, so it snapshots the
// current composer and publishes it immediately instead of waiting for the
// debounce. Removing it again in `stop()` keeps reconnects clean.
const FLUSH_ARM = 'if(this.pinkieDraftFlush)globalThis.document?.removeEventListener?.("visibilitychange",this.pinkieDraftFlush);'
  + 'this.pinkieDraftFlush=()=>{this.schedule();this.persistNow()};'
  + 'globalThis.document?.addEventListener?.("visibilitychange",this.pinkieDraftFlush,{capture:!0});';
const FLUSH_DISARM = 'globalThis.document?.removeEventListener?.("visibilitychange",this.pinkieDraftFlush,{capture:!0});';

/** Insert `snippet` as its own statement at the end of a matched method. */
function insertInMethod(match, snippet) {
  const brace = match.lastIndexOf("}");
  return brace < 0
    ? match + ';' + snippet
    : match.slice(0, brace) + ';' + snippet + '}';
}

function injectFlush(source, start, stop) {
  // 2026.7 `start()` ends with `}` and 2026.10 with `…;`, so the arm snippet
  // goes before that final brace, or straight after the `;`.
  const afterStart = replaceOptional(source, start, (match) => insertInMethod(match, FLUSH_ARM));
  if (!afterStart.applied) return undefined;
  // Re-anchor on the already-patched text: FLUSH_ARM is a prefix of FLUSH_DISARM.
  const afterStop = replaceOptional(afterStart.source, stop,
    (match) => insertInMethod(match, FLUSH_DISARM));
  return afterStop.applied ? afterStop.source : undefined;
}

/** Returns the patched source, or undefined when this bundle is not a store. */
export function transform(source) {
  if (source.includes(marker)) return source;
  if (source.includes('/* pinkie-composer-drafts:v3 */')) {
    const next = source.replace('/* pinkie-composer-drafts:v3 */',marker);
    if (!next.includes('openclaw.control.chatComposer.v1:')) return next;
    return replaceOne(next,/function pinkieComposerReadOnly\(state\) \{[\s\S]*?\n\}/g,
      () => pinkieComposerReadOnly.toString());
  }
  if (source.includes('/* pinkie-composer-drafts:v2 */')) {
    let next = source.replace('/* pinkie-composer-drafts:v2 */',marker);
    if (!next.includes('openclaw.control.chatComposer.v1:')) return next;
    next = replaceOne(next,/function pinkieDurableComposerStore\(native, session\) \{[\s\S]*?\n\}/g,() => pinkieDurableComposerStore.toString());
    next = replaceOne(next,/function pinkieCaptureComposerInput\(gatewayKey, sessionKey\) \{[\s\S]*?\n\}/g,() => pinkieCaptureComposerInput.toString());
    const calls=/pinkieDurableComposerStore\((\w+)\(\),(\w+)\((\w+),(\w+)\?\?\3\.sessionKey\)\)/g;
    if ([...next.matchAll(calls)].length!==4) throw new Error('v2 草稿调用边界不明确，未覆盖');
    next=next.replace(calls,(_all,accessor,sessionKey,state,session)=>`pinkieDurableComposerStore(${accessor}(),${sessionKey}(${state},${session}??${state}.sessionKey),${state})`);
    return pinkieComposerReadOnly.toString()+'\n'+next;
  }
  if (source.includes(previousMarker)) return marker+'\n'+withDurableLegacyDrafts(source.replace(previousMarker,''));
  // 2026.10 enforces its own bounds; older stores evict queue-only entries by
  // count, and unfinished drafts must survive that.
  const bounded = replaceOptional(source,
    /let (\w+)=Object\.entries\((\w+)\.sessions\)\.toSorted\(([^;]+?)\)\.slice\(0,(\w+)\);/g,
    (_, rows, store, compare, limit) => `let pinkieQueueOnlyCount=0;let ${rows}=Object.entries(${store}.sessions).toSorted(${compare}).filter(([,entry])=>Boolean(entry.draft)||pinkieQueueOnlyCount++<${limit});`);
  let next = bounded.source;
  const legacy = replaceOptional(next, LEGACY_PERSIST, 'persistChangedState(){this.persistNow()}');
  if (legacy.applied) {
    next = injectFlush(legacy.source, LEGACY_START, LEGACY_STOP);
  } else {
    const current = replaceOptional(next, CURRENT_PERSIST,
      'persistChangedState(){this.persistNow();this.synchronizeDurablePersistence?.();this.persistNow()}');
    if (!current.applied) {
      if (!bounded.applied) return source;
      throw new Error('原生草稿保存结构已变化，未覆盖：persistChangedState');
    }
    next = injectFlush(current.source, CURRENT_START, CURRENT_STOP);
  }
  // A bundle whose lifecycle methods moved on is left byte-for-byte untouched
  // rather than written half-patched.
  return next ? marker + '\n' + withDurableLegacyDrafts(next) : source;
}

export function apply(root, {backupRoot} = {}) {
  const ui = path.join(root, 'dist/control-ui'), assets = path.join(ui, 'assets');
  const files = fs.readdirSync(assets).filter(name => name.endsWith('.js'));
  const composer = files.filter(name => {
    const source = fs.readFileSync(path.join(assets,name),'utf8');
    return source.includes('openclaw.control.chatComposer.v1:')
      || source.includes('this.pending&&this.persistNow()');
  });
  // 2026.10 keeps the draft store in a different Control UI chunk than the
  // legacy composer key; only the chunk holding the store logic is a target.
  const stores = files.filter(name =>
    fs.readFileSync(path.join(assets,name),'utf8').includes('this.pending&&this.persistNow()'));
  if (stores.length === 1) composer.splice(0, composer.length, stores[0]);
  if (composer.length !== 1) throw new Error('未找到唯一的原生草稿模块');
  const moduleName = composer[0], moduleFile = path.join(assets,moduleName);
  const changes = new Map();
  const original = fs.readFileSync(moduleFile,'utf8');
  const patched = transform(original);
  if (patched === original && !original.includes(marker)) throw new Error('原生草稿保存结构已变化，未覆盖：draft store module');  if (patched !== original) changes.set(moduleFile,patched);
  // Old bundles import the draft chunk by name; bump the query so the browser
  // drops its cached copy. 2026.10 hashes module names in index.html instead,
  // so there only the precompressed twins need refreshing.
  if (/^chat-page-/u.test(moduleName)) {
    const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const importPattern = new RegExp(escaped+'(?:\\?[^"\x27`]*?)?(?=["\x27`])','g');
    for (const name of files) {
      if (name === moduleName) continue;
      const file = path.join(assets,name), source = fs.readFileSync(file,'utf8');
      const next = source.replace(importPattern, refreshCache);
      if (next !== source) changes.set(file,next);
    }
    const indexFile = path.join(ui,'index.html');
    if (fs.existsSync(indexFile)) {
      const index = fs.readFileSync(indexFile,'utf8');
      const html = index.replace(/((?:src|href)=")((?:\/|\.\/)?assets\/[^"?]+\.js(?:\?[^" ]*)?)(")/g,
        (_, before, asset, after) => before+refreshCache(asset)+after);
      if (html !== index) changes.set(indexFile,html);
    }
  }
  if (!changes.size) return {changed:false,files:[]};
  const backup = backupRoot || path.join(root,'.pinkie-backups',`drafts-${Date.now()}`);
  fs.mkdirSync(backup,{recursive:true});
  for (const [file,next] of changes) {
    fs.copyFileSync(file,path.join(backup,path.basename(file)));
    const temp = file+'.pinkie-drafts-tmp';
    fs.writeFileSync(temp,next); fs.renameSync(temp,file);
  }
  for (const file of changes.keys()) refreshPrecompressed(file);
  return {changed:true,files:[...changes.keys()],backup};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.OPENCLAW_ROOT) throw new Error('Set OPENCLAW_ROOT');
  console.log(JSON.stringify(apply(process.env.OPENCLAW_ROOT,{backupRoot:process.env.PINKIE_PATCH_BACKUP_ROOT||undefined})));
}
