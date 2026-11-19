#!/usr/bin/env node
// Offline preparation only. No provider calls, no staging in a user profile.
// node tools/metre/roles/compose.mjs <role-id> <brief-file>
// node tools/metre/roles/compose.mjs --matrix <explicit-child-model-id>
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {formatRoleCardPrompt, loadRoles} from '../../../services/mode-architecture/metre-roles.mjs';
import {metreChildMessage, normalizeChildRequest} from '../../../services/mode-architecture/session-lineage.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
export const PILOT_ROLES = Object.freeze(['researcher', 'backend-fix', 'ui-replicator', 'reviewer']);
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');

export function composeMetreArms(id, brief, {title = 'Metre 角色试点', model = '', rolesWorkspaceDir = ''} = {}) {
  const registry = loadRoles({officialDir: path.join(REPO, 'personas/metre/roles'), userDir: '', rolesWorkspaceDir,
    stateDir: HERE, managedDir: ''});
  const card = registry.byId[id];
  if (!card) throw new Error(`角色不在合格官方卡列表中：${id}`);
  // Normalize once, using the same path as real dispatch, then give every arm
  // the exact same brief. The B prefix is distinct from the common brief.
  const {prompt} = normalizeChildRequest({title, prompt: brief, role: id, initiation: 'user_asked', model}, {metre: true, rolesEnabled: true});
  const briefSha256 = sha(prompt);
  const common = {brief: prompt, briefSha256, ...(model ? {model} : {})};
  return {
    role: id, roleBodySha256: card.bodyHash, rawBriefSha256: sha(brief),
    A: {...common, agent: 'project', message: metreChildMessage({prompt})},
    B: {...common, agent: 'project', message: metreChildMessage({prompt: `${card.body}\n\n${prompt}`})},
    C: {...common, agent: 'roles', messagePreview: metreChildMessage({prompt, metreRole: id, metreRoleName: card.name}),
      cardPromptPreview: formatRoleCardPrompt(card),
      // C requires real lineage and role snapshot from the production tool.
      // Sending messagePreview to a bare roles session would NOT test arm C.
      dispatch: {title, prompt, role: id, initiation: 'user_asked', ...(model ? {model} : {})}},
  };
}

export function metrePilotMatrix(model) {
  if (typeof model !== 'string' || !model.trim() || model.length > 200) throw new Error('需要指定一个供三组共用的子会话模型 ID');
  const cases = [], runs = [];
  for (const role of PILOT_ROLES) {
    const {samples} = JSON.parse(fs.readFileSync(path.join(HERE, 'samples', `${role}.json`), 'utf8'));
    if (!Array.isArray(samples) || samples.length !== 2) throw new Error(`${role} 缺两道试点样题`);
    for (const sample of samples) {
      const arms = composeMetreArms(role, sample.brief, {title: sample.id, model});
      cases.push({role, id: sample.id, files: sample.files, checks: sample.checks, plantedIssues: sample.planted_issues || []});
      for (const group of ['A', 'B', 'C']) {
        for (const repeat of [1, 2]) runs.push({id: `${sample.id}-${group}${repeat}`, caseId: sample.id, group, repeat, ...arms[group]});
      }
    }
  }
  return {status: 'prepared-not-run', model, cases, runs};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args.length !== 2) throw new Error('用法：compose.mjs <角色 id> <简报文件> 或 compose.mjs --matrix <模型 id>');
    const result = args[0] === '--matrix'
      ? metrePilotMatrix(args[1])
      : composeMetreArms(args[0], fs.readFileSync(args[1], 'utf8'));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
