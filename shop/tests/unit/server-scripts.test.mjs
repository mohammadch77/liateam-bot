// The npm scripts that run ON THE SERVER (Node 20, no TypeScript loader, devDependencies pruned) must not reach a .ts file
// and may only import packages from "dependencies". The check is static (it reads the import graph), so it catches the
// problem on a laptop whose newer Node strips types and would hide it. The scripts that answer --help are also really run,
// with type stripping switched off where this Node supports that, to behave like Node 20.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// Run by a developer (browsers, Lighthouse, icon build, font tooling), never on the server
const DEV_ONLY = new Set([
  'build-icons.mjs',
  'check-responsive.mjs',
  'perf.mjs',
  'font-check.mjs',
  'load-test.mjs',
]);

const serverScripts = Object.entries(pkg.scripts)
  .map(([name, cmd]) => [name, /^node (scripts\/[\w.-]+\.mjs)\b/.exec(cmd)?.[1]])
  .filter(([, file]) => file && !DEV_ONLY.has(path.basename(file)));

const specifiers = (src) => {
  const out = [];
  for (const m of src.matchAll(/(?:import|export)\s[^'"()]*?from\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of src.matchAll(/import\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  // import(pathToFileURL(path.join(root, 'src/lib/x.mjs')).href) and new URL('../x', import.meta.url)
  for (const m of src.matchAll(/path\.join\(\s*root\s*,\s*['"]([^'"]+\.(?:m?js|tsx?))['"]/g))
    out.push(`ROOT:${m[1]}`);
  return out;
};

/** every file a script loads, and the bare packages it imports */
function graph(entry) {
  const files = new Set();
  const packages = new Set();
  const visit = (file) => {
    if (files.has(file)) return;
    files.add(file);
    if (!/\.m?js$/.test(file)) return; // a .ts file is reported, not read
    for (const spec of specifiers(fs.readFileSync(file, 'utf8'))) {
      if (spec.startsWith('node:') || builtinModules.includes(spec)) continue;
      if (spec.startsWith('ROOT:')) visit(path.join(root, spec.slice(5)));
      else if (spec.startsWith('.')) visit(path.resolve(path.dirname(file), spec));
      else packages.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
    }
  };
  visit(path.join(root, entry));
  return { files, packages };
}

test('there are server scripts to check (admin, migrate, grant-role at least)', () => {
  const names = serverScripts.map(([n]) => n);
  for (const n of ['admin:create', 'admin:revoke', 'grant-role', 'migrate:up'])
    assert.ok(names.includes(n), `${n} is not among the server scripts`);
});

for (const [name, file] of serverScripts) {
  test(`npm run ${name}: its import graph has no .ts file, no missing file and only production packages`, () => {
    const { files, packages } = graph(file);
    const ts = [...files].filter((f) => /\.tsx?$/.test(f)).map((f) => path.relative(root, f));
    assert.deepEqual(ts, [], `${file} reaches TypeScript (Node 20 cannot load it): ${ts.join(', ')}`);
    const missing = [...files].filter((f) => !fs.existsSync(f)).map((f) => path.relative(root, f));
    assert.deepEqual(missing, [], `${file} imports files that do not exist`);
    const notProd = [...packages].filter((p) => !(p in (pkg.dependencies ?? {})));
    assert.deepEqual(
      notProd,
      [],
      `${file} needs packages missing from "dependencies" (pruned on the server): ${notProd.join(', ')}`,
    );
  });
}

// Really run the scripts that answer --help (they import their whole graph first). Node >= 22.10 can turn type stripping
// off, which makes this Node refuse .ts exactly as Node 20 does.
const [major, minor] = process.versions.node.split('.').map(Number);
const canDisableStripping = major > 22 || (major === 22 && minor >= 10);
for (const name of ['admin:create', 'admin:revoke', 'grant-role']) {
  test(`npm run ${name} -- --help runs ${canDisableStripping ? 'with type stripping off (like Node 20)' : 'on this Node'}`, () => {
    const file = serverScripts.find(([n]) => n === name)[1];
    const r = spawnSync(
      process.execPath,
      [...(canDisableStripping ? ['--no-experimental-strip-types'] : []), file, '--help'],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: '', MIGRATION_DATABASE_URL: '' },
      },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /usage:/);
    assert.doesNotMatch(r.stderr, /ERR_UNKNOWN_FILE_EXTENSION|ERR_MODULE_NOT_FOUND/);
  });
}

test('the phone logic is one module: phone.ts only re-exports phone.mjs', () => {
  const ts = fs.readFileSync(path.join(root, 'src/lib/phone.ts'), 'utf8');
  assert.match(ts, /from '\.\/phone\.mjs'/);
  assert.ok(!/function normalizeMobile/.test(ts));
});

test('engines matches the server (Node 20)', () => {
  assert.match(pkg.engines.node, />=20/);
});
