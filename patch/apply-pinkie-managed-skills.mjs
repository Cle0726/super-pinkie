// Build-time patch for the packaged OpenClaw runtime. Product skills are
// searched before user extra directories, never copied into user workspaces.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const marker = '/* pinkie-scoped-managed-skills:v2 */';
const before = 'const mergedExtraDirs = [...extraDirs, ...pluginSkillDirs];';
const after = `${marker}
	const pinkieProductSkills = (() => {
		const directory = process.env.PINKIE_MANAGED_SKILLS_DIR;
		if (!directory || workspaceOnly) return [];
		const agents = Array.isArray(opts?.config?.agents?.list) ? opts.config.agents.list : [];
		const matching = agents.filter((agent) => {
			if (typeof agent?.id !== "string" || !agent.id.trim()) return false;
			try { return path.resolve(pinkieResolveAgentWorkspaceDir(opts.config, agent.id)) === path.resolve(workspaceDir); }
			catch { return false; }
		});
		const allowed = new Set(["main", "project", "thinking", "learning"]);
		// A shared workspace with any other agent is ambiguous: do not change it.
		return matching.length && matching.every((agent) => allowed.has(agent.id)) ? [directory] : [];
	})();
	const mergedExtraDirs = [...pinkieProductSkills, ...extraDirs, ...pluginSkillDirs];`;

export function patchRuntime(root) {
  if (!root) throw new Error('OPENCLAW_ROOT is required');
  const dist = path.join(root, 'dist');
  const files = fs.readdirSync(dist).filter(n => /^workspace-.*\.js$/.test(n));
  const scopeFiles = fs.readdirSync(dist).filter(n => /^agent-scope-config-.*\.js$/.test(n));
  const scopes = scopeFiles.flatMap(name => {
    const source = fs.readFileSync(path.join(dist, name), 'utf8');
    const match = source.match(/resolveAgentWorkspaceDir as (\w+)/);
    return match ? [{name, symbol: match[1]}] : [];
  });
  if (scopes.length !== 1) throw new Error(`expected one agent workspace resolver, found ${scopes.length}`);
  const header = `import { ${scopes[0].symbol} as pinkieResolveAgentWorkspaceDir } from "./${scopes[0].name}";\n`;
  let found = 0, changed = 0;
  for (const name of files) {
    const file = path.join(dist, name), text = fs.readFileSync(file, 'utf8');
    if (text.includes(marker)) { found++; continue; }
    if (!text.includes(before)) continue;
    if (text.split(before).length !== 2) throw new Error(`ambiguous skill loader: ${name}`);
    found++;
    const temporary = `${file}.pinkie-${process.pid}.tmp`;
    try { fs.writeFileSync(temporary, header + text.replace(before, after)); fs.renameSync(temporary, file); }
    finally { try { fs.unlinkSync(temporary); } catch {} }
    changed++;
  }
  if (found !== 1) throw new Error(`expected one compatible workspace skill loader, found ${found}`);
  return {found, changed};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(patchRuntime(process.env.OPENCLAW_ROOT)));
}
