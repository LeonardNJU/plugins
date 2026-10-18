#!/usr/bin/env node
// Build and package plugins.
//
//   node scripts/build.mjs                 build every plugin
//   node scripts/build.mjs gravatar smime  build the named plugins
//   node scripts/build.mjs --check         fail if a committed zip is stale
//
// Each plugin folder has manifest.json and src/index.js. The bundle is
// CommonJS (the host evaluates it with `new Function(module, exports,
// require)`), with React, the host API and the UI kit left external. The zip holds
// manifest.json and index.js at its root, which is what the admin upload,
// the marketplace and the dev directory all expect.
//
// A plugin can add esbuild options under "bulwarkBuild" in its package.json,
// e.g. { "alias": { "crypto": "./src/node-crypto-shim.js" } }.

import { build } from 'esbuild';
import JSZip from 'jszip';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// @plugin-host/ui is the app's UI kit, provided by the sandbox like React.
const EXTERNAL = ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', '@plugin-host', '@plugin-host/ui'];
// Fixed timestamp so rebuilding unchanged sources gives a byte-identical zip.
const ZIP_DATE = new Date('2026-01-01T00:00:00Z');

function pluginDirs() {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(ROOT, d.name, 'manifest.json'))
      && existsSync(path.join(ROOT, d.name, 'src')))
    .map((d) => d.name);
}

async function bundle(dir) {
  const pkgPath = path.join(ROOT, dir, 'package.json');
  const extra = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')).bulwarkBuild ?? {} : {};
  const alias = Object.fromEntries(Object.entries(extra.alias ?? {})
    .map(([k, v]) => [k, path.resolve(ROOT, dir, v)]));
  const entry = ['src/index.js', 'src/index.jsx', 'src/index.ts', 'src/index.tsx']
    .map((f) => path.join(ROOT, dir, f)).find(existsSync);
  if (!entry) throw new Error(`${dir}: no src/index.{js,jsx,ts,tsx}`);
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    charset: 'utf8',
    jsx: 'automatic',
    external: EXTERNAL,
    alias,
    write: false,
    logLevel: 'warning',
    minify: extra.minify === true,
    // The bundle names each module's path in a comment. Resolve paths from
    // the repository root and keep linked node_modules as they are, so the
    // zip is the same from any working directory or checkout layout.
    absWorkingDir: ROOT,
    preserveSymlinks: true,
  });
  return result.outputFiles[0].contents;
}

// Line ends are made LF, so a checkout with core.autocrlf (CRLF files)
// builds the same zip as one without. JavaScript reads CRLF in template
// literals as LF anyway, so the bundle means the same.
const toLf = (text) => text.replace(/\r\n/g, '\n');

async function packageZip(dir, code) {
  const manifest = toLf(readFileSync(path.join(ROOT, dir, 'manifest.json'), 'utf8'));
  const zip = new JSZip();
  zip.file('manifest.json', manifest, { date: ZIP_DATE });
  zip.file('index.js', toLf(Buffer.from(code).toString('utf8')), { date: ZIP_DATE });
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}

const args = process.argv.slice(2);
const check = args.includes('--check');
const wanted = args.filter((a) => !a.startsWith('--'));
const dirs = wanted.length ? wanted : pluginDirs();
let stale = 0;

for (const dir of dirs) {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, dir, 'manifest.json'), 'utf8'));
  const code = await bundle(dir);
  const zip = await packageZip(dir, code);
  const out = path.join(ROOT, dir, `${dir}.zip`);
  if (check) {
    const current = existsSync(out) ? readFileSync(out) : null;
    if (!current || !current.equals(zip)) {
      console.error(`stale: ${dir}.zip (run node scripts/build.mjs ${dir})`);
      stale++;
    }
    continue;
  }
  writeFileSync(out, zip);
  console.log(`${dir}.zip  ${manifest.version}  ${(code.length / 1024).toFixed(1)} KB`);
}

if (stale) process.exit(1);
