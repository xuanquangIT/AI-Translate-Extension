/**
 * Parses every src/**\/*.js file in the right mode (classic content script vs
 * ES module) without executing it. Requires --experimental-vm-modules.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { classifySourceFiles, root, toPosix } from './lib/source-files.mjs';

const { classicScripts, modules } = classifySourceFiles();
const failures = [];

for (const file of modules) {
  try {
    new vm.SourceTextModule(readFileSync(file, 'utf8'), { identifier: toPosix(path.relative(root, file)) });
  } catch (error) {
    failures.push(`${toPosix(path.relative(root, file))}: ${error.message}`);
  }
}
for (const file of classicScripts) {
  try {
    new vm.Script(readFileSync(file, 'utf8'), { filename: toPosix(path.relative(root, file)) });
  } catch (error) {
    failures.push(`${toPosix(path.relative(root, file))}: ${error.message}`);
  }
}

if (failures.length) {
  console.error(`Syntax errors:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`Syntax OK: ${modules.length} modules, ${classicScripts.length} classic scripts.`);
