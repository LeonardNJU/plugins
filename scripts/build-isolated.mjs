#!/usr/bin/env node
// Build plugins the way the extension directory does: each plugin folder
// alone in an empty directory, `npm ci --ignore-scripts` (npm install when
// there is no lockfile), then `npm run build`, and the entrypoint from
// manifest.json must be in dist/, build/ or the folder afterwards.
//
//   node scripts/build-isolated.mjs                  every plugin with a build script
//   node scripts/build-isolated.mjs smime gravatar   some plugins
//   node scripts/build-isolated.mjs --link           link node_modules instead of
//                                                    installing (offline, local)
//
// The copy holds the files git would put in the source archive: tracked
// and new files, not ignored ones. With --link, the copy's node_modules
// points at the plugin's own node_modules if it has one, otherwise at the
// repository's; that skips the install, so it doesn't prove the lockfile.

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function hasBuildScript(dir) {
  const file = path.join(ROOT, dir, 'package.json');
  if (!existsSync(file)) return false;
  const build = JSON.parse(readFileSync(file, 'utf8')).scripts?.build;
  return typeof build === 'string' && build.trim() !== '';
}

function sourceFiles(dir) {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', dir],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean).filter((f) => existsSync(path.join(ROOT, f)) && statSync(path.join(ROOT, f)).isFile());
}

function run(cmd, args, cwd) {
  // npm.cmd needs a shell on Windows; the arguments are fixed strings.
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, CI: 'true' } });
  return r.status ?? 1;
}

function buildOne(dir, link) {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, dir, 'manifest.json'), 'utf8'));
  const entry = (manifest.type === 'theme' ? 'theme.css' : manifest.entrypoint || 'index.js').replace(/^\.?\//, '');
  const work = mkdtempSync(path.join(os.tmpdir(), `plugin-${dir}-`));
  const linked = path.join(work, 'node_modules');
  try {
    for (const f of sourceFiles(dir)) {
      const dest = path.join(work, f.slice(dir.length + 1));
      mkdirSync(path.dirname(dest), { recursive: true });
      cpSync(path.join(ROOT, f), dest);
    }
    if (link) {
      const own = path.join(ROOT, dir, 'node_modules');
      symlinkSync(existsSync(own) ? own : path.join(ROOT, 'node_modules'), linked, 'junction');
    } else {
      const install = existsSync(path.join(work, 'package-lock.json'))
        ? ['ci', '--ignore-scripts', '--no-audit', '--no-fund']
        : ['install', '--ignore-scripts', '--no-audit', '--no-fund'];
      console.log(`$ npm ${install.join(' ')}`);
      if (run(npm, install, work) !== 0) return `npm ${install[0]} failed; if package-lock.json is out of date, run npm install in ${dir}/`;
    }
    console.log('$ npm run build');
    if (run(npm, ['run', 'build'], work) !== 0) return 'npm run build failed';
    const found = ['dist', 'build', ''].find((d) => existsSync(path.join(work, d, entry)));
    if (found === undefined) return `npm run build finished, but ${entry} is not in dist/, build/ or the plugin folder`;
    const size = statSync(path.join(work, found, entry)).size;
    console.log(`${dir}: ${found ? `${found}/` : ''}${entry}  ${(size / 1024).toFixed(1)} KB`);
    return null;
  } finally {
    // Remove the link itself first, so nothing behind it is deleted.
    try {
      if (lstatSync(linked).isSymbolicLink()) unlinkSync(linked);
    } catch {
      // no link
    }
    rmSync(work, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
const link = args.includes('--link');
const wanted = args.filter((a) => !a.startsWith('--'));
const dirs = wanted.length ? wanted : execFileSync('git', ['ls-files', '--', '*/manifest.json'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter((f) => f.split('/').length === 2).map((f) => f.split('/')[0]).filter(hasBuildScript);

const failed = [];
for (const dir of dirs) {
  if (!existsSync(path.join(ROOT, dir, 'manifest.json'))) {
    failed.push(`${dir}: there is no ${dir}/manifest.json`);
    continue;
  }
  if (!hasBuildScript(dir)) {
    console.log(`${dir}: no build script, the directory packs the folder as it is`);
    continue;
  }
  const group = process.env.GITHUB_ACTIONS === 'true';
  if (group) console.log(`::group::${dir}`);
  const error = buildOne(dir, link);
  if (group) console.log('::endgroup::');
  if (error) {
    failed.push(`${dir}: ${error}`);
    if (group) console.log(`::error file=${dir}/package.json::${error}`);
  }
}

for (const f of failed) console.error(f);
if (failed.length) process.exit(1);
console.log(dirs.length === 1 ? `built ${dirs[0]} on its own` : `built ${dirs.length} plugins, each on its own`);
