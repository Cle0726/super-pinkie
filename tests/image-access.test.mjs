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
  assert.equal(transform(oldPatched),oldPatched);
  assert.equal(transform(currentPatched),currentPatched);
});

test('image access patch validates before changing the runtime and is idempotent',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cle-kk-image-access-'));
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
