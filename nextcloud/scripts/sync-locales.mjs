#!/usr/bin/env node
// Copy locales/<lang>.json into manifest.json "locales", in a fixed order.
//   node nextcloud/scripts/sync-locales.mjs          write
//   node nextcloud/scripts/sync-locales.mjs --check  fail if they differ
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(DIR, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const locales = {};
for (const file of readdirSync(path.join(DIR, 'locales')).filter((f) => f.endsWith('.json')).sort()) {
  locales[file.slice(0, -5)] = JSON.parse(readFileSync(path.join(DIR, 'locales', file), 'utf8'));
}
const next = JSON.stringify({ ...manifest, locales }, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(manifestPath, 'utf8') !== next) {
    console.error('manifest.json locales are stale: run node nextcloud/scripts/sync-locales.mjs');
    process.exit(1);
  }
} else {
  writeFileSync(manifestPath, next);
}
