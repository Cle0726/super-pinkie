import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const store = new Map();
store.set("laolao.sidebar.v1", JSON.stringify({
  pins: ["agent:main:one", "agent:thinking:two"],
  projects: {
    Shared: ["agent:main:one", "agent:project:three"],
    Empty: [],
  },
  projectFolders: {
    Shared: "/projects/shared",
    Empty: "/projects/empty",
  },
  collapsed: { __projects: true },
}));

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  addEventListener() {}
}

const localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
};
const documentElement = { getAttribute: (name) => name === "data-laolao-mode" ? "chat" : null };
const context = {
  window: {
    WebSocket: FakeWebSocket,
    addEventListener() {},
  },
  document: {
    readyState: "loading",
    documentElement,
    querySelector: () => null,
    addEventListener() {},
  },
  location: { href: "http://127.0.0.1:18789/" },
  localStorage,
  MutationObserver: class { observe() {} },
  URL,
  URLSearchParams,
  Map,
  Set,
  Object,
  Array,
  String,
  JSON,
  Math,
  Date,
  Promise,
  setTimeout: () => 0,
  clearTimeout() {},
  setInterval: () => 0,
  console,
};
context.window.window = context.window;
context.window.document = context.document;
context.window.localStorage = localStorage;

vm.runInNewContext(fs.readFileSync("ui/injections/laolao-sidebar.js", "utf8"), context);

const read = (mode) => JSON.parse(store.get(`laolao.sidebar.v2.${mode}`));
const chat = read("chat");
const project = read("project");
const thinking = read("thinking");
const unrestricted = read("unrestricted");

assert.deepEqual(chat.pins, ["agent:main:one"]);
assert.deepEqual(thinking.pins, ["agent:thinking:two"]);
assert.deepEqual(project.pins, []);
assert.deepEqual(unrestricted.pins, []);
assert.deepEqual(chat.projects.Shared, ["agent:main:one"]);
assert.deepEqual(project.projects.Shared, ["agent:project:three"]);
assert.equal(chat.projectFolders.Shared, "/projects/shared");
assert.equal(project.projectFolders.Shared, undefined);
assert.equal(chat.projectFolders.Empty, "/projects/empty");
assert.equal(store.get("laolao.sidebar.v2.migrated"), "1");
assert.ok(store.has("laolao.sidebar.v1"), "legacy state remains as a recovery copy");

console.log("四模式侧边栏状态迁移与隔离校验通过");
