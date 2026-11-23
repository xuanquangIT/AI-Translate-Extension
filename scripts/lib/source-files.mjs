/** Shared helpers for repository validation scripts. */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const srcDir = path.join(root, 'src');

export function toPosix(value) {
  return value.split(path.sep).join('/');
}

export function walk(dir, predicate = () => true) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, predicate));
    else if (predicate(full)) files.push(full);
  }
  return files;
}

export function readManifest() {
  return JSON.parse(readFileSync(path.join(srcDir, 'manifest.json'), 'utf8'));
}

/** Content scripts are classic scripts; every other src/**\/*.js file is an ES module. */
export function classifySourceFiles() {
  const manifest = readManifest();
  const classic = new Set(
    (manifest.content_scripts || []).flatMap((entry) => entry.js || []).map((file) => path.join(srcDir, file))
  );
  const all = walk(srcDir, (file) => file.endsWith('.js'));
  return {
    classicScripts: all.filter((file) => classic.has(file)),
    modules: all.filter((file) => !classic.has(file))
  };
}

const STATIC_IMPORT = /(?:^|[\s;])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]/g;
const BARE_IMPORT = /(?:^|[\s;])import\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

export function importSpecifiers(source) {
  const specifiers = new Set();
  for (const pattern of [STATIC_IMPORT, BARE_IMPORT, DYNAMIC_IMPORT]) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers];
}
