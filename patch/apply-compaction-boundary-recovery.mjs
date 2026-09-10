/** Repair OpenClaw safeguard compaction when stale zero-token metadata makes
 * preparation keep the whole branch. The transcript remains intact; only the
 * next model-context boundary is moved to the recent-turn tail. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const marker='/* pinkie-compaction-boundary-recovery:v1 */';
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
const helper=`${collect}
function resolveRecoveryFirstKeptEntryId(sessionManager, fallbackId, recentTurnsPreserve) {
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

function replaceOnce(text,from,to){
  if(text.split(from).length!==2)throw new Error('OpenClaw 压缩保护结构已变化，未覆盖：'+from.slice(0,100));
  return text.replace(from,to);
}

export function transform(original){
  if(original.includes(marker))return original;
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
\t\t\t\teffectiveFirstKeptEntryId = resolveRecoveryFirstKeptEntryId(ctx.sessionManager, preparation.firstKeptEntryId, recentTurnsPreserve);
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
  const names=fs.readdirSync(dist).filter(name=>name.startsWith('attempt.model-diagnostic-events-')&&name.endsWith('.js')).filter(name=>{
    const source=fs.readFileSync(path.join(dist,name),'utf8');
    return source.includes(marker)||source.includes('Compaction safeguard: using session branch messages after compaction preparation omitted real conversation content.');
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
