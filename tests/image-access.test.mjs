import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apply,transform} from '../patch/apply-image-access.mjs';

const anchor='/** Verifies that a local media path is managed inbound media or lives under allowed roots. */\nasync function assertLocalMediaAllowed(';
const legacy=`import path from "node:path";\n${anchor}mediaPath, localRoots) {\n\tif (await resolveInboundMediaReference(mediaPath).catch(() => null)) return;\n}`;
const current=`import path from "node:path";\nasync function resolveLocalMediaBoundary(mediaPath, localRoots) {\n\tconst roots = localRoots ?? getDefaultLocalRootsCore();\n\tconst resolved = await resolveLocalMediaPathForContainment(mediaPath);\n\treturn {roots,resolved};\n}\n${anchor}mediaPath, localRoots) {}`;

test('image access supports both legacy and current OpenClaw boundary layouts',()=>{
  const oldPatched=transform(legacy),currentPatched=transform(current);
  assert.match(oldPatched,/_pinkiePathIsUnderRoots/);
  assert.match(currentPatched,/\.\.\._pinkieResolveExtraMediaRoots\(\)/);
  assert.match(oldPatched,/_pinkieWorkspaceRoots/);
  assert.match(oldPatched,/workspace\(\?:-\[a-z0-9\]/);
  assert.match(oldPatched,/Do not allow ~\/\.openclaw itself/);
  assert.match(oldPatched,/if \(_pinkiePathIsUnderRoots\(mediaPath, _pinkieResolveExtraMediaRoots\(\)\)\) return/);
  assert.equal(transform(oldPatched),oldPatched);
  assert.equal(transform(currentPatched),currentPatched);
});

test('image access upgrades the previous narrow v1 patch in place',()=>{
  const v1=`/* pinkie-image-access:v1 */\nimport os from "node:os";\nlet _pinkieExtraMediaRoots;\nfunction _pinkieResolveExtraMediaRoots() { return []; }\nfunction _pinkiePathIsUnderRoots() { return false; }\n${anchor}mediaPath, localRoots) {\n\tif (await resolveInboundMediaReference(mediaPath).catch(() => null)) return;\n\tif (localRoots === void 0 && _pinkiePathIsUnderRoots(mediaPath, _pinkieResolveExtraMediaRoots())) return;\n}`;
  const upgraded=transform(v1);
  assert.match(upgraded,/pinkie-image-access:v3/);
  assert.doesNotMatch(upgraded,/pinkie-image-access:v1/);
  assert.match(upgraded,/_pinkieWorkspaceRoots/);
  assert.match(upgraded,/import fsSync from "node:fs"/);
  assert.equal(transform(upgraded),upgraded);
});

test('image access upgrades v2 so Control UI agent-scoped roots include exact workspaces',()=>{
  const v2=transform(legacy).replace('pinkie-image-access:v3','pinkie-image-access:v2')
    .replace(
      'if (_pinkiePathIsUnderRoots(mediaPath, _pinkieResolveExtraMediaRoots())) return;',
      'if (localRoots === void 0 && _pinkiePathIsUnderRoots(mediaPath, _pinkieResolveExtraMediaRoots())) return;'
    );
  const upgraded=transform(v2);
  assert.match(upgraded,/pinkie-image-access:v3/);
  assert.match(upgraded,/if \(_pinkiePathIsUnderRoots\(mediaPath, _pinkieResolveExtraMediaRoots\(\)\)\) return/);
  assert.doesNotMatch(upgraded,/localRoots === void 0 && _pinkiePathIsUnderRoots/);
  assert.equal(transform(upgraded),upgraded);
});

test('image access patch validates before changing the runtime and is idempotent',()=>{  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cle-kk-image-access-'));
  try{
    const dist=path.join(root,'dist');fs.mkdirSync(dist);
    const file=path.join(dist,'local-media-access-test.js');
    fs.writeFileSync(file,current);
    const backup=path.join(root,'backup');
    assert.equal(apply(root,{backupRoot:backup}).changed,true);
    assert.equal(fs.readFileSync(path.join(backup,path.basename(file)),'utf8'),current);
    assert.equal(apply(root,{backupRoot:backup}).changed,false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

// OpenClaw 2026.10 layout: the managed-reference lookup is wrapped in
// try/catch, defaults come from getDefaultMediaLocalRoots(), and the bundle is
// a .mjs file (a sibling re-export shim shares the prefix).
const current2026 = `import path from "node:path";
async function resolveLocalMediaBoundary(mediaPath, localRoots, managedReferenceErrors, options) {
\tif (localRoots === "any") return {roots: "any"};
\tlet inboundReference;
\ttry {
\t\tinboundReference = await resolveInboundMediaReference(mediaPath);
\t} catch (err) {
\t\tif (!(err instanceof MediaReferenceError)) throw err;
\t}
\tif (inboundReference) return {roots: [path.dirname(inboundReference.physicalPath)]};
\tconst roots = localRoots ?? getDefaultMediaLocalRoots();
\tconst resolved = await resolveLocalMediaPathForContainment(mediaPath);
\treturn {roots,resolved};
}
/** Verifies that a local media path is managed inbound media or lives under allowed roots. */
async function assertLocalMediaAllowed(mediaPath, localRoots, options) {
\tawait resolveLocalMediaBoundary(mediaPath, localRoots, "ignore", options);
}
`;

test('2026.10 boundary check allows the extra roots before inbound resolution and in the default root list',()=>{
  const patched=transform(current2026);
  assert.notEqual(patched,current2026);
  assert.match(patched,/pinkie-image-access:v3/);
  assert.match(patched,/if \(_pinkiePathIsUnderRoots\(mediaPath, _pinkieResolveExtraMediaRoots\(\)\)\) return \{\n\t\trejectHardlinks: false,\n\t\troots: \[path\.dirname\(path\.resolve\(mediaPath\)\)\]\n\t\};/);
  assert.match(patched,/const roots = \[\.\.\.\(localRoots \?\? getDefaultMediaLocalRoots\(\)\), \.\.\._pinkieResolveExtraMediaRoots\(\)\];/);
  assert.match(patched,/try \{\n\t\tinboundReference = await resolveInboundMediaReference\(mediaPath\);/,'the managed-reference branch is kept');
  assert.equal(transform(patched),patched,'idempotent');
});

test('2026.10 picks the real .mjs chunk, not a re-export shim',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cle-kk-image-access-2026-'));
  try{
    const dist=path.join(root,'dist');fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist,'local-media-access-REEXPORT.mjs'),'export { a as b } from "./local-media-access-REAL.mjs";\n');
    const real=path.join(dist,'local-media-access-REAL.mjs');
    fs.writeFileSync(real,current2026);
    assert.equal(apply(root,{backupRoot:path.join(root,'backup')}).file,'local-media-access-REAL.mjs');
    assert.match(fs.readFileSync(real,'utf8'),/pinkie-image-access:v3/);
    assert.doesNotMatch(fs.readFileSync(path.join(dist,'local-media-access-REEXPORT.mjs'),'utf8'),/pinkie/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
