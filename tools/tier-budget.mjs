#!/usr/bin/env node
// What one selection of the two tier systems adds on top of the main reply, read from the same
// contract the engine uses. No model is called; use it to size a real-model test before spending quota.
//
//   node tools/tier-budget.mjs --mode project --level max --tier full "做个落地页介绍我的烘焙店"
//   node tools/tier-budget.mjs --level ultra "谢谢"
//   node tools/tier-budget.mjs --tier boost --level xhigh --task "做个待办清单小网页" "继续"
//
// --mode    chat | ideas | project | learning            (default chat)
// --level   off … ultra, or omit                          (nine thinking levels)
// --tier    base | boost | full | marathon, or omit       (four rigor tiers)
// --native  the model's own levels, comma separated       (default low,medium,high)
// --task    the earlier request a bare 「继续」 refers to
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'services', 'mode-architecture');
const load = (name) => import(pathToFileURL(path.join(root, name)).href);
const {RIGOR_LADDER, buildContract, messageWeight} = await load('run-contract.mjs');
const {classifyWorkKind, independentViews, kindLabel, kindRoles} = await load('work-kinds.mjs');
const {recipeFor} = await load('reasoning.mjs');

const argv = process.argv.slice(2);
const flags = {};
const words = [];
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index].startsWith('--')) { flags[argv[index].slice(2)] = argv[index + 1] ?? ''; index += 1; } else words.push(argv[index]);
}
const message = words.join(' ');
if (!message) {
  console.error('usage: node tools/tier-budget.mjs [--mode chat] [--level max] [--tier full] [--native low,medium,high] [--task "…"] "消息"');
  process.exit(2);
}
const mode = flags.mode || 'chat';
const level = flags.level || '';
const tier = RIGOR_LADDER[flags.tier] ? flags.tier : '';
const agent = {chat: 'main', ideas: 'thinking', project: 'project', learning: 'learning'}[mode] || 'main';
const sessionKey = `agent:${agent}:budget`;
const record = {id: 'model', reasoning: true, compat: {supportedReasoningEfforts: (flags.native || 'low,medium,high').split(',').filter(Boolean)}};

const weight = messageWeight(message);
const subject = weight === 'carry' ? flags.task || '' : message;
const kinds = weight === 'social' || !subject ? [] : classifyWorkKind(subject, {mode}).kinds;
const recipe = level ? recipeFor(level, record, {message: subject || message, sessionKey}) : {};
const views = independentViews(kinds, tier);
const contract = buildContract({
  level, workTier: tier, kinds, mode, weight, hasTask: Boolean(subject), tierViews: views,
  levelCopies: recipe.solvers ?? 0, levelRounds: recipe.rounds ?? 0, levelCritic: recipe.critic ?? false, levelBrevity: Boolean(recipe.brevity),
});

// Helpers the tier asks the model to send out itself (solvers for answers and trade-offs, plus the kind's own roles).
const social = weight === 'social';
const roles = tier && !social ? kindRoles(kinds, tier).roles : {};
const solverRoles = !social && RIGOR_LADDER[tier]?.roles === 'required' && ['standard_answer', 'tradeoff'].includes(kinds[0]) ? 2 : 0;
const helpers = Object.values(roles).reduce((sum, count) => sum + count, 0) + solverRoles;
const review = contract.review ? 1 : 0;
const least = helpers + contract.copiesBy.engine + review;
// Each send-back is one corrected reply plus one re-review.
const most = least + (review ? 2 * contract.rounds : 0);

console.log(JSON.stringify({
  message, mode, level: level || null, tier: tier || null, weight,
  kinds: kinds.map((kind) => `${kind}（${kindLabel(kind)}）`),
  levelOnThisModel: level ? {kind: recipe.kind, native: recipe.native, ...(recipe.as ? {as: recipe.as} : {})} : null,
  helpersSentByTheTier: {...roles, ...(solverRoles ? {solver: solverRoles} : {})},
  independentVersions: {total: contract.copies, fromTheTier: contract.copiesBy.tier, fromTheNineLevelEngine: contract.copiesBy.engine},
  deliveryReview: Boolean(review), sendBackRounds: contract.rounds,
  remindOnce: contract.pushes, shortProseAllChecksKept: contract.concise,
  extraModelCalls: {least, most},
  continuationLimit: contract.continuationLimit,
}, null, 2));
