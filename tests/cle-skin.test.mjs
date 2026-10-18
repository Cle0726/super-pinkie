import test from 'node:test';
import assert from 'node:assert/strict';
import {retainSkin} from '../services/cle-studio/src/core/skin.js';

function fixture() {
  const links = [];
  const doc = {
    querySelectorAll: () => links.filter((link) => link.connected),
    head: {append(link) { link.connected = true; links.push(link); }},
    createElement() {
      return {connected: false, handlers: {}, setAttribute() {},
        addEventListener(type, fn) { this.handlers[type] = fn; },
        remove() { this.connected = false; },
      };
    },
  };
  return {doc, links, live: () => links.filter((link) => link.connected)};
}
const revision = (id) => `http://127.0.0.1:19789/__openclaw__/plugins/control-ui/cle-studio/${id}/index.js`;

test('disconnect cannot remove the document-owned CSS, and a same-revision reconnect adds no copy', () => {
  const f = fixture();
  retainSkin(revision('a'), f.doc);
  const first = f.live()[0];
  first.handlers.load();
  // The host can remove its own link; this independent link stays in the document.
  assert.equal(first.href, revision('a').replace('index.js', 'index.css'));
  retainSkin(revision('a'), f.doc);
  assert.equal(f.live().length, 1);
  assert.equal(f.live()[0], first);
});

test('a hot revision retains the last good CSS until load, then replaces it exactly once', () => {
  const f = fixture();
  retainSkin(revision('a'), f.doc);
  f.live()[0].handlers.load();
  retainSkin(revision('b'), f.doc);
  assert.equal(f.live().length, 2, 'old skin bridges the loading interval');
  f.live().at(-1).handlers.load();
  assert.equal(f.live().length, 1);
  assert.equal(f.live()[0].href, revision('b').replace('index.js', 'index.css'));
});

test('a failed stylesheet update leaves the previous skin and allows a later retry', () => {
  const f = fixture();
  retainSkin(revision('a'), f.doc);
  f.live()[0].handlers.load();
  retainSkin(revision('b'), f.doc);
  f.live().at(-1).handlers.error();
  assert.equal(f.live().length, 1);
  assert.equal(f.live()[0].href, revision('a').replace('index.js', 'index.css'));
  retainSkin(revision('b'), f.doc);
  f.live().at(-1).handlers.load();
  assert.equal(f.live().length, 1);
  assert.equal(f.live()[0].href, revision('b').replace('index.js', 'index.css'));
});
