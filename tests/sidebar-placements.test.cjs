// pinkie_sessions 的 create 建好会话后，侧栏把它挂进对应项目（Metre 计划 2.7，ACCEPTANCE A2-2 的界面部分）。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const plain = value => JSON.parse(JSON.stringify(value));

const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-sidebar.js'), 'utf8');
const start = source.indexOf('  // pinkie_sessions 的 create');
const end = source.indexOf("  window.addEventListener('laolao:sessions-changed'");
const segment = source.slice(start, end);

function harness(state, placements) {
  const calls = [], saved = [];
  const ctx = {
    state, stateMode: 'project', sessionIndex: 'old', currentModeAgent: () => 'project', schedule() {},
    window: {PinkieSessionList: {invalidate() {}}},
    writeModeState: (mode, value) => saved.push([mode, JSON.parse(JSON.stringify(value))]),
    gwRequest: async (method, params) => {
      calls.push([method, params]);
      if (method === 'pinkie.session.manage.placements') return {placements};
      return {ok: true};
    },
  };
  vm.createContext(ctx);
  vm.runInContext(segment + '\nthis.adoptPlacements = adoptPlacements;', ctx);
  return {ctx, calls, saved};
}

test('the segment is found', () => {
  assert.ok(start > 0 && end > start);
});

test('a created session joins the project with the same folder (Windows case and trailing slash ignored)', async () => {
  const state = {projects: {网站: ['agent:project:dashboard:old']}, projectFolders: {网站: 'F:\\Projects\\Site'}, pins: [], collapsed: {}};
  const f = harness(state, {'agent:project:dashboard:new': {project: 'site', folder: 'f:\\projects\\site\\'}});
  await f.ctx.adoptPlacements();
  assert.deepEqual(plain(state.projects.网站), ['agent:project:dashboard:old', 'agent:project:dashboard:new']);
  assert.equal(Object.keys(state.projectFolders).length, 1);
  assert.deepEqual(plain(f.calls.at(-1)), ['pinkie.session.manage.placed', {keys: ['agent:project:dashboard:new']}]);
  assert.equal(f.saved[0][0], 'project');
  assert.equal(f.ctx.sessionIndex, null);
});

test('an unknown folder becomes a new project; a name clash gets a number instead of merging folders', async () => {
  const state = {projects: {site: ['x']}, projectFolders: {site: 'D:\\other\\site'}, pins: [], collapsed: {}};
  const f = harness(state, {
    'agent:project:dashboard:a': {project: 'site', folder: 'F:\\Projects\\site'},
    'agent:project:dashboard:b': {project: '', folder: 'F:\\Projects\\blog'},
  });
  await f.ctx.adoptPlacements();
  assert.equal(state.projectFolders['site（2）'], 'F:\\Projects\\site');
  assert.deepEqual(plain(state.projects['site（2）']), ['agent:project:dashboard:a']);
  assert.equal(state.projectFolders.blog, 'F:\\Projects\\blog');
  assert.equal(state.projectFolders.site, 'D:\\other\\site');
});

test('nothing to place: no write, no ack; a session already in a project is left where the user put it', async () => {
  const empty = harness({projects: {}, projectFolders: {}}, {});
  await empty.ctx.adoptPlacements();
  assert.equal(empty.saved.length, 0);
  assert.equal(empty.calls.length, 1);
  const state = {projects: {Mine: ['agent:project:dashboard:a']}, projectFolders: {Mine: 'E:\\m'}};
  const f = harness(state, {'agent:project:dashboard:a': {project: 'site', folder: 'F:\\site'}});
  await f.ctx.adoptPlacements();
  assert.deepEqual(plain(state.projects), {Mine: ['agent:project:dashboard:a']});
  assert.deepEqual(plain(f.calls.at(-1)[1]), {keys: ['agent:project:dashboard:a']});
});
