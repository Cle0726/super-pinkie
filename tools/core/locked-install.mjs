// Installs a cle-core tarball exactly the way npm installs the published
// openclaw package: every dependency pinned by the package's shrinkwrap and
// nested under openclaw/node_modules.
//
// `npm install <file.tgz>` cannot be used: for file tarballs npm ignores the
// shrinkwrap, floats dependency versions and hoists them next to the package.
// desktop/macos/build.sh copies only the package directory, so a hoisted tree
// produces an App without dependencies.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const CORE_KEY = 'node_modules/openclaw';
const AI_KEY = 'node_modules/@openclaw/ai';
const STAGE = '.cle-core';
const VENDORED_AI = 'package/cle-vendor/openclaw-ai.tgz';

const integrityOf = (file) => `sha512-${crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64')}`;

// Install scripts of third-party packages must never see repository tokens.
export function envWithoutTokens(env = process.env) {
  const clean = { ...env };
  for (const key of Object.keys(clean)) {
    if (/^(CLE_CORE_TOKEN|GH_TOKEN|GITHUB_TOKEN)$/i.test(key)) delete clean[key];
  }
  return clean;
}

export function buildInstallLock({ pkg, shrinkwrap, core, ai }) {
  if (shrinkwrap.version !== pkg.version) {
    throw new Error(`cle-core shrinkwrap ${shrinkwrap.version} does not match package ${pkg.version}`);
  }
  if (shrinkwrap.packages?.[AI_KEY]?.version !== pkg.version) {
    throw new Error(`cle-core shrinkwrap must pin @openclaw/ai ${pkg.version}`);
  }
  const root = { name: 'pinkie-core-prefix', private: true, dependencies: { openclaw: core.resolved } };
  const packages = {
    '': { name: root.name, dependencies: root.dependencies },
    [CORE_KEY]: {
      version: pkg.version,
      resolved: core.resolved,
      integrity: core.integrity,
      hasInstallScript: true,
      license: pkg.license,
      dependencies: pkg.dependencies,
      optionalDependencies: pkg.optionalDependencies,
      bin: pkg.bin,
      engines: pkg.engines,
    },
  };
  for (const [key, entry] of Object.entries(shrinkwrap.packages)) {
    if (!key) continue;
    if (!key.startsWith('node_modules/') || key.split('/').includes('..')) {
      throw new Error(`cle-core shrinkwrap has an invalid path: ${key}`);
    }
    packages[`${CORE_KEY}/${key}`] = key === AI_KEY
      ? { ...entry, resolved: ai.resolved, integrity: ai.integrity }
      : entry;
  }
  return { root, lock: { name: root.name, lockfileVersion: 3, requires: true, packages } };
}

export function installLockedTarball({ tarball, prefixDir, coreVersion, runNpm, registry }) {
  const modules = path.join(prefixDir, 'node_modules');
  if (fs.existsSync(modules)) {
    // npm ci empties node_modules, so only ever run it in a prefix owned by the core.
    const foreign = fs.readdirSync(modules).filter((name) => name !== 'openclaw' && !name.startsWith('.'));
    if (foreign.length) {
      throw new Error(`${modules} is not a dedicated core prefix (found ${foreign.slice(0, 5).join(', ')})`);
    }
  }

  const stage = path.join(prefixDir, STAGE);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  try {
    fs.copyFileSync(tarball, path.join(stage, 'openclaw.tgz'));
    // Relative names: GNU tar on Windows reads "C:" as a remote host.
    const tar = spawnSync(
      'tar',
      ['-xzf', 'openclaw.tgz', 'package/package.json', 'package/npm-shrinkwrap.json', VENDORED_AI],
      { cwd: stage, encoding: 'utf8', env: envWithoutTokens() },
    );
    if (tar.error) throw tar.error;
    if (tar.status !== 0) {
      throw new Error(
        `cle-core ${coreVersion} is not a lock-installable package (needs npm-shrinkwrap.json and ${VENDORED_AI}): `
        + String(tar.stderr).trim(),
      );
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(stage, 'package/package.json'), 'utf8'));
    if (pkg.name !== 'openclaw' || !coreVersion.startsWith(`${pkg.version}-c.`)) {
      throw new Error(`cle-core ${coreVersion} contains ${pkg.name}@${pkg.version}; the base version must match`);
    }
    fs.copyFileSync(path.join(stage, VENDORED_AI), path.join(stage, 'openclaw-ai.tgz'));

    const local = (name) => ({ resolved: `file:${STAGE}/${name}`, integrity: integrityOf(path.join(stage, name)) });
    const { root, lock } = buildInstallLock({
      pkg,
      shrinkwrap: JSON.parse(fs.readFileSync(path.join(stage, 'package/npm-shrinkwrap.json'), 'utf8')),
      core: local('openclaw.tgz'),
      ai: local('openclaw-ai.tgz'),
    });
    fs.writeFileSync(path.join(prefixDir, 'package.json'), `${JSON.stringify(root, null, 2)}\n`);
    fs.writeFileSync(path.join(prefixDir, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);

    runNpm(['ci', '--prefix', prefixDir, '--registry', registry, '--omit=dev', '--no-audit', '--no-fund']);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}
