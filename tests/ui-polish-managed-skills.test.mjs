import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {patchRuntime} from '../patch/apply-pinkie-managed-skills.mjs';

test('product skills are lower priority and limited to the four explicitly configured workspaces', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-skills-'));
  const previous = process.env.PINKIE_MANAGED_SKILLS_DIR;
  try {
    const dist=path.join(temp,'runtime','dist');fs.mkdirSync(dist,{recursive:true});
    const file=path.join(dist,'workspace-fixture.js');
    fs.writeFileSync(path.join(temp,'runtime','package.json'),'{"type":"module"}');
    fs.writeFileSync(path.join(dist,'agent-scope-config-fixture.js'),`function resolveAgentWorkspaceDir(config,id){const a=config.agents.list.find(x=>x.id===id);return a.workspace??config.agents.defaults.workspace;}\nexport {resolveAgentWorkspaceDir as r};`);
    fs.writeFileSync(file,`import path from 'node:path';\nconst resolveUserPath=x=>x;\nexport function dirs(workspaceDir,opts){const workspaceOnly=opts?.workspaceOnly===true;const extraDirs=opts?.config?.skills?.load?.extraDirs??[];const pluginSkillDirs=[];const mergedExtraDirs = [...extraDirs, ...pluginSkillDirs];return mergedExtraDirs;}\n`);
    assert.deepEqual(patchRuntime(path.join(temp,'runtime')),{found:1,changed:1});
    assert.deepEqual(patchRuntime(path.join(temp,'runtime')),{found:1,changed:0});
    const {dirs}=await import(pathToFileURL(file).href);
    const agents=['main','project','thinking','learning','other'].map(id=>({id,workspace:path.join(temp,id)}));
    const config={agents:{list:agents},skills:{load:{extraDirs:['user-extra']}}};
    process.env.PINKIE_MANAGED_SKILLS_DIR=path.join(temp,'product');
    for(const agent of agents.slice(0,4)) assert.deepEqual(dirs(agent.workspace,{config}),[process.env.PINKIE_MANAGED_SKILLS_DIR,'user-extra']);
    assert.deepEqual(dirs(agents[4].workspace,{config}),['user-extra']);
    assert.deepEqual(dirs(agents[0].workspace,{config,workspaceOnly:true}),['user-extra']);
    const ambiguous={...config,agents:{list:[...agents.slice(0,4),{id:'other',workspace:agents[0].workspace}]}};
    assert.deepEqual(dirs(agents[0].workspace,{config:ambiguous}),['user-extra']);
    const implicit={...config,agents:{defaults:{workspace:agents[0].workspace},list:[agents[0],{id:'other',default:true}]}};
    assert.deepEqual(dirs(agents[0].workspace,{config:implicit}),['user-extra']);
    delete process.env.PINKIE_MANAGED_SKILLS_DIR;
    assert.deepEqual(dirs(agents[0].workspace,{config}),['user-extra']);
    assert.throws(()=>patchRuntime(path.join(temp,'missing')));
  } finally {
    if(previous===undefined) delete process.env.PINKIE_MANAGED_SKILLS_DIR; else process.env.PINKIE_MANAGED_SKILLS_DIR=previous;
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
