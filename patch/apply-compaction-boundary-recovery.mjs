/** Repair OpenClaw safeguard compaction when stale zero-token metadata makes
 * preparation keep the whole branch. The transcript remains intact; only the
 * next model-context boundary is moved to the recent-turn tail. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const marker='/* pinkie-compaction-boundary-recovery:v2 */';
const legacyMarker='/* pinkie-compaction-boundary-recovery:v1 */';
const collect=`function collectSessionBranchMessages(sessionManager) {
	const getBranch = sessionManager?.getBranch;
	if (typeof getBranch !== "function") return [];
	let entries;
	try {
		entries = getBranch.call(sessionManager);
	} catch {
		return [];
	}
	if (!Array.isArray(entries)) return [];
	return entries.map((entry) => entry && typeof entry === "object" ? sessionBranchEntryToMessage(entry) : void 0).filter((message) => Boolean(message));
}`;
const legacyResolver=`function resolveRecoveryFirstKeptEntryId(sessionManager, fallbackId, recentTurnsPreserve) {
	const getBranch = sessionManager?.getBranch;
	if (typeof getBranch !== "function") return fallbackId;
	let entries;
	try {
		entries = getBranch.call(sessionManager);
	} catch {
		return fallbackId;
	}
	if (!Array.isArray(entries) || entries.length === 0) return fallbackId;
	const userEntryIndexes = [];
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry?.type === "message" && entry.message?.role === "user" && typeof entry.id === "string") userEntryIndexes.push(index);
	}
	const keepTurns = Math.max(1, Number.isFinite(recentTurnsPreserve) ? Math.floor(recentTurnsPreserve) : 8);
	if (userEntryIndexes.length > 0) {
		const index = userEntryIndexes[Math.max(0, userEntryIndexes.length - keepTurns)];
		const id = entries[index]?.id;
		if (typeof id === "string" && id) return id;
	}
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type === "message" && typeof entry.id === "string" && entry.id) return entry.id;
	}
	return fallbackId;
}`;
const resolver=`function estimateRecoveryEntryPressure(entry) {
	try {
		return Math.max(1, JSON.stringify(entry?.message ?? entry ?? "").length);
	} catch {
		return 4096;
	}
}
function resolveRecoveryFirstKeptEntryId(sessionManager, fallbackId, options = {}) {
	const getBranch = sessionManager?.getBranch;
	if (typeof getBranch !== "function") return fallbackId;
	let entries;
	try {
		entries = getBranch.call(sessionManager);
	} catch {
		return fallbackId;
	}
	if (!Array.isArray(entries) || entries.length === 0) return fallbackId;
	const keepTurns = Math.max(1, Number.isFinite(options.recentTurnsPreserve) ? Math.floor(options.recentTurnsPreserve) : 3);
	const contextWindowTokens = Math.max(1, Number.isFinite(options.contextWindowTokens) ? Math.floor(options.contextWindowTokens) : 2e5);
	const configuredKeepTokens = Number.isFinite(options.keepRecentTokens) && options.keepRecentTokens > 0 ? Math.floor(options.keepRecentTokens) : contextWindowTokens;
	// This recovery path is entered only when OpenClaw's normal token boundary
	// is stale and returns no real conversation. Bound the raw suffix by both
	// the requested tail and half the model window. JSON characters are used as
	// a deliberately conservative proxy so image/tool payloads cannot make a
	// handful of UI turns refill the whole context immediately after compaction.
	const maxTailChars = Math.max(4096, Math.min(Math.floor(contextWindowTokens * .5), Math.floor(configuredKeepTokens * 2)));
	let pressure = 0;
	let keptUserTurns = 0;
	let oldestTailId;
	let oldestUserBoundaryId;
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type !== "message" || typeof entry.id !== "string" || !entry.id) continue;
		const isUser = entry.message?.role === "user";
		if (isUser && keptUserTurns >= keepTurns) break;
		const nextPressure = pressure + estimateRecoveryEntryPressure(entry);
		if (nextPressure > maxTailChars && oldestTailId) break;
		pressure = nextPressure;
		oldestTailId = entry.id;
		if (isUser) {
			keptUserTurns += 1;
			oldestUserBoundaryId = entry.id;
		}
	}
	return oldestUserBoundaryId ?? oldestTailId ?? fallbackId;
}`;
const helper=`${collect}
${resolver}`;

function replaceOnce(text,from,to){
  if(text.split(from).length!==2)throw new Error('OpenClaw 压缩保护结构已变化，未覆盖：'+from.slice(0,100));
  return text.replace(from,to);
}
const CURRENT_MARKER='/* pinkie-compaction-boundary-recovery:v3 */';
const currentCollect=`function collectSessionBranchMessages(sessionManager) {
	const getBranch = sessionManager?.getBranch;
	if (typeof getBranch !== "function") return [];
	let entries;
	try {
		entries = getBranch.call(sessionManager);
	} catch {
		return [];
	}
	if (!Array.isArray(entries)) return [];
	return entries.map((entry) => entry && typeof entry === "object" ? sessionBranchEntryToMessage(entry) : void 0).filter((message) => Boolean(message));
}`;
const currentResolver=`function estimateRecoveryEntryPressure(entry) {
	try {
		return Math.max(1, JSON.stringify(entry?.message ?? entry ?? "").length);
	} catch {
		return 4096;
	}
}
function resolveRecoveryFirstKeptEntryId(sessionManager, fallbackId, options = {}) {
	const getBranch = sessionManager?.getBranch;
	if (typeof getBranch !== "function") return fallbackId;
	let entries;
	try {
		entries = getBranch.call(sessionManager);
	} catch {
		return fallbackId;
	}
	if (!Array.isArray(entries) || entries.length === 0) return fallbackId;
	const keepTurns = Math.max(1, Number.isFinite(options.recentTurnsPreserve) ? Math.floor(options.recentTurnsPreserve) : 3);
	const contextWindowTokens = Math.max(1, Number.isFinite(options.contextWindowTokens) ? Math.floor(options.contextWindowTokens) : 2e5);
	const configuredKeepTokens = Number.isFinite(options.keepRecentTokens) && options.keepRecentTokens > 0 ? Math.floor(options.keepRecentTokens) : contextWindowTokens;
	// The normal token boundary runs first. Only when it leaves no real
	// conversation does this path bound the raw suffix: by the requested tail
	// and by half the model window, using JSON characters as a deliberately
	// conservative proxy so image/tool payloads cannot refill the context.
	const maxTailChars = Math.max(4096, Math.min(Math.floor(contextWindowTokens * .5), Math.floor(configuredKeepTokens * 2)));
	let pressure = 0;
	let keptUserTurns = 0;
	let oldestTailId;
	let oldestUserBoundaryId;
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type !== "message" || typeof entry.id !== "string" || !entry.id) continue;
		const isUser = entry.message?.role === "user";
		if (isUser && keptUserTurns >= keepTurns) break;
		const nextPressure = pressure + estimateRecoveryEntryPressure(entry);
		if (nextPressure > maxTailChars && oldestTailId) break;
		pressure = nextPressure;
		oldestTailId = entry.id;
		if (isUser) {
			keptUserTurns += 1;
			oldestUserBoundaryId = entry.id;
		}
	}
	return oldestUserBoundaryId ?? oldestTailId ?? fallbackId;
}`;

/**
 * OpenClaw 2026.10 keeps the safeguard in dist/builtin-openclaw-*.mjs and
 * rewrote the recovery path: it summarizes the boundary-scoped preparation
 * range and only falls back to a structured empty summary. Both of those keep
 * `preparation.firstKeptEntryId`, which is exactly the stale boundary this
 * patch repairs. Earlier releases are handled by transform() above.
 */
export function transformCurrent(original){
  if(original.includes(CURRENT_MARKER))return original;
  const hook='\t\tconst { preparation, customInstructions: eventInstructions, signal, thinkingLevel, streamFn } = event;\n';
  if(original.split(hook).length!==2)return null;
  let text=original.replace(hook,
    hook+'\t\tconst pinkieBoundaryRuntime = getCompactionSafeguardRuntime(ctx.sessionManager);\n'
    + '\t\tconst pinkieRecoveryBoundary = () => resolveRecoveryFirstKeptEntryId(ctx.sessionManager, preparation.firstKeptEntryId, { recentTurnsPreserve: resolveRecentTurnsPreserve(pinkieBoundaryRuntime?.recentTurnsPreserve), contextWindowTokens: pinkieBoundaryRuntime?.contextWindowTokens, keepRecentTokens: preparation.settings?.keepRecentTokens });\n');
  const empty='\t\tif (!hasRealConversation) {\n';
  if(text.split(empty).length!==2)return null;
  text=text.replace(empty,
    empty+'\t\t\tconst pinkieFirstKeptEntryId = pinkieRecoveryBoundary();\n');
  const emptyBoundary='\t\t\t\tfirstKeptEntryId: preparation.firstKeptEntryId,\n\t\t\t\ttokensBefore: preparation.tokensBefore\n\t\t\t} };\n';
  if(text.split(emptyBoundary).length!==2)return null;
  text=text.replace(emptyBoundary,
    '\t\t\t\tfirstKeptEntryId: pinkieFirstKeptEntryId,\n\t\t\t\ttokensBefore: preparation.tokensBefore\n\t\t\t} };\n');
  const resultBoundary='\t\tconst compactionResult = (summary) => ({ compaction: {\n\t\t\tsummary,\n\t\t\tfirstKeptEntryId: preparation.firstKeptEntryId,\n';
  if(text.split(resultBoundary).length!==2)return null;
  text=text.replace(resultBoundary,
    '\t\tconst pinkieResultBoundary = resolveRecoveryFirstKeptEntryId(ctx.sessionManager, preparation.firstKeptEntryId, { recentTurnsPreserve, contextWindowTokens: pinkieBoundaryRuntime?.contextWindowTokens, keepRecentTokens: preparation.settings?.keepRecentTokens });\n'
    + '\t\tconst compactionResult = (summary) => ({ compaction: {\n\t\t\tsummary,\n\t\t\tfirstKeptEntryId: pinkieResultBoundary,\n');
  // Helper functions go right before the extension factory; they are hoisted.
  const factory='function compactionSafeguardExtension(api) {';
  const at=text.indexOf(factory);
  if(at<0)return null;
  text=text.slice(0,at)+currentCollect+'\n'+currentResolver+'\n'+text.slice(at);
  return CURRENT_MARKER+'\n'+text;
}


export function transform(original){
  if(original.includes(marker)||original.includes(CURRENT_MARKER))return original;
  const current=transformCurrent(original);
  if(current)return current;
  if(original.includes(legacyMarker)){
    let text=replaceOnce(original,legacyMarker,marker);
    text=replaceOnce(text,legacyResolver,resolver);
    text=replaceOnce(text,
      'resolveRecoveryFirstKeptEntryId(ctx.sessionManager, preparation.firstKeptEntryId, recentTurnsPreserve);',
      'resolveRecoveryFirstKeptEntryId(ctx.sessionManager, preparation.firstKeptEntryId, { recentTurnsPreserve, contextWindowTokens: runtime?.contextWindowTokens, keepRecentTokens: preparation.settings?.keepRecentTokens });');
    return text;
  }
  let text=replaceOnce(original,collect,helper);
  const start=`\t\tconst rawTurnPrefixMessages = preparation.turnPrefixMessages ?? [];
\t\tlet baseMessagesToSummarize`;
  text=replaceOnce(text,start,`\t\tconst rawTurnPrefixMessages = preparation.turnPrefixMessages ?? [];
\t\tconst runtime = getCompactionSafeguardRuntime(ctx.sessionManager);
\t\tconst recentTurnsPreserve = resolveRecentTurnsPreserve(runtime?.recentTurnsPreserve);
\t\tlet effectiveFirstKeptEntryId = preparation.firstKeptEntryId;
\t\tlet baseMessagesToSummarize`);
  const recovery=`\t\t\t\tbaseMessagesToSummarize = branchMessages;
\t\t\t\tbaseTurnPrefixMessages = [];
\t\t\t\thasRealSummarizable = true;`;
  text=replaceOnce(text,recovery,`\t\t\t\tbaseMessagesToSummarize = branchMessages;
\t\t\t\tbaseTurnPrefixMessages = [];
\t\t\t\teffectiveFirstKeptEntryId = resolveRecoveryFirstKeptEntryId(ctx.sessionManager, preparation.firstKeptEntryId, { recentTurnsPreserve, contextWindowTokens: runtime?.contextWindowTokens, keepRecentTokens: preparation.settings?.keepRecentTokens });
\t\t\t\thasRealSummarizable = true;`);
  text=replaceOnce(text,`\t\tconst runtime = getCompactionSafeguardRuntime(ctx.sessionManager);
\t\tconst customInstructions`, `\t\tconst customInstructions`);
  text=replaceOnce(text,`\t\tconst recentTurnsPreserve = resolveRecentTurnsPreserve(runtime?.recentTurnsPreserve);
\t\tconst { preservedMessages`, `\t\tconst { preservedMessages`);
  const boundary='firstKeptEntryId: preparation.firstKeptEntryId,';
  if(text.split(boundary).length!==4)throw new Error('OpenClaw 压缩边界返回结构已变化，未覆盖');
  text=text.replaceAll(boundary,'firstKeptEntryId: effectiveFirstKeptEntryId,');
  return marker+'\n'+text;
}

export function apply(root,{backupRoot}={}){
  const dist=path.join(root,'dist');
  // 2026.7: attempt.model-diagnostic-events-*.js
  // 2026.10: the safeguard lives in builtin-openclaw-*.mjs
  const names=fs.readdirSync(dist).filter(name=>/^attempt\.model-diagnostic-events-.*\.js$/.test(name)||/^builtin-openclaw-.*\.mjs$/.test(name)).filter(name=>{
    const source=fs.readFileSync(path.join(dist,name),'utf8');
    return source.includes(marker)||source.includes(CURRENT_MARKER)||source.includes(legacyMarker)
      ||source.includes('Compaction safeguard: using session branch messages after compaction preparation omitted real conversation content.')
      ||source.includes('Compaction safeguard: no real conversation messages to summarize; writing compaction boundary to suppress re-trigger loop.');
  });
  if(names.length!==1)throw new Error('OpenClaw 压缩保护模块无法唯一确认');
  const file=path.join(dist,names[0]);
  const original=fs.readFileSync(file,'utf8');
  const next=transform(original);
  if(next===original)return {changed:false,file};
  const backup=backupRoot||path.join(os.homedir(),'Library/Application Support/SuperPinkie/backups','compaction-boundary-'+Date.now());
  fs.mkdirSync(backup,{recursive:true,mode:0o700});
  fs.copyFileSync(file,path.join(backup,path.basename(file)));
  if(fs.readFileSync(file,'utf8')!==original)throw new Error('压缩保护模块正在变化，未覆盖');
  fs.writeFileSync(file,next);
  return {changed:true,file,backup};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let root=process.env.OPENCLAW_ROOT;
  if(!root){
    const entries=execFileSync(process.platform==='win32'?'where':'which',['openclaw'],{encoding:'utf8'}).trim().split(/\r?\n/);
    for(const entry of entries){
      const dir=path.dirname(fs.realpathSync(entry));
      root=[dir,path.join(dir,'node_modules/openclaw')].find(candidate=>fs.existsSync(path.join(candidate,'dist')));
      if(root)break;
    }
  }
  if(!root)throw new Error('无法找到 OpenClaw 包目录，请明确设置 OPENCLAW_ROOT');
  console.log(JSON.stringify(apply(root,{backupRoot:process.env.PINKIE_PATCH_BACKUP_ROOT||undefined})));
}
