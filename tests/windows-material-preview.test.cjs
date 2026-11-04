const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-material-preview.js'), 'utf8');
const start = source.indexOf('const requestSidebarPreview = ');
const end = source.indexOf('const runFileAction = ', start);
assert.ok(start >= 0 && end > start);

function create(platform, nativePreview) {
  const posted = [];
  const events = new Map();
  const window = {
    pywebview: nativePreview ? {api:{preview_material(){}}} : undefined,
    webkit:{messageHandlers:{laolaoBrowserWorkspace:{postMessage:p=>posted.push(p)}}},
    addEventListener:(name, fn)=>events.set(name, fn),
    removeEventListener:name=>events.delete(name),
    setTimeout, clearTimeout,
  };
  const document = {documentElement:{dataset:{pinkiePlatform:platform}}};
  const request = vm.runInNewContext(`(() => {const sidebarPreviews = new Map(); ${source.slice(start,end)} return requestSidebarPreview;})()`, {window,document,Map,Promise,Error});
  return {request,posted,events};
}

test('Windows retains the validated local-material viewer when the browser bridge exists', async () => {
  const h = create('windows', true);
  assert.equal(await h.request({path:'C:/Users/test/report.txt'}), false);
  assert.equal(h.posted.length, 0, 'local file paths are not sent to the external web browser');
  assert.match(source, /else openPreview\(rail, target\)/, 'false returns to the existing native material preview');
});

test('the Mac native-browser acknowledgement path is unchanged', async () => {
  const h = create('macos', false);
  const result = h.request({path:'/Users/test/report.txt'});
  assert.equal(h.posted[0].action, 'show-file');
  h.events.get('laolao:browser-show-file')({detail:{path:'/Users/test/report.txt',ok:true}});
  assert.equal(await result, true);
});
