import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const moduleFiles = [
  'src/scripts/background.js',
  'src/scripts/lib/api.js',
  'src/scripts/lib/config.js',
  'src/scripts/lib/storage.js',
  'src/scripts/lib/translation-utils.js'
];

const classicScriptFiles = [
  'src/scripts/content.js',
  'src/pages/popup/popup.js',
  'src/pages/options/options.js'
];

for (const relativePath of moduleFiles) {
  const source = await readFile(path.join(root, relativePath), 'utf8');
  new vm.SourceTextModule(source, { identifier: relativePath });
}

for (const relativePath of classicScriptFiles) {
  const source = await readFile(path.join(root, relativePath), 'utf8');
  new vm.Script(source, { filename: relativePath });
}

console.log(`Syntax checks passed for ${moduleFiles.length + classicScriptFiles.length} files.`);
