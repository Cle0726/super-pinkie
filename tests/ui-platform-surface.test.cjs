const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('8 GB and software rendering do not suppress glass or animation', () => {
  const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-platform-surface.js'), 'utf8');
  for (const gl of [null, {
    RENDERER: 1, getExtension: () => null, getParameter: () => 'SwiftShader software',
  }]) {
    let oldAttribute = true, oldSheet = true;
    const document = {
      createElement: () => ({getContext: () => gl}),
      documentElement: {removeAttribute: name => { if (name === 'data-pinkie-lite') oldAttribute = false; }},
      getElementById: name => name === 'pinkie-lite' ? {remove: () => { oldSheet = false; }} : null,
    };
    const context = {window: {}, document, navigator: {deviceMemory: 8},
      localStorage: {getItem: () => '1'}};
    vm.runInNewContext(source, context);
    assert.equal(context.window.__pinkieSurface.software, true);
    assert.equal(context.window.__pinkieSurface.lite, false);
    assert.equal(oldAttribute, false);
    assert.equal(oldSheet, false);
  }
});
