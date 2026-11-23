/**
 * Static extension integrity check (no browser needed):
 * - every file referenced by manifest.json and by page HTML exists;
 * - every relative ES import resolves to a file inside src/;
 * - ES modules never import bare packages (there is no bundler);
 * - content scripts contain no import/export statements;
 * - layer rules from docs/ARCHITECTURE.md hold.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  classifySourceFiles,
  importSpecifiers,
  readManifest,
  root,
  srcDir,
  toPosix,
  walk
} from './lib/source-files.mjs';

const errors = [];
const rel = (file) => toPosix(path.relative(root, file));
const requireFile = (relativeToSrc, origin) => {
  if (!relativeToSrc) errors.push(`${origin} is missing`);
  else if (!existsSync(path.join(srcDir, relativeToSrc)))
    errors.push(`${origin} references missing src/${relativeToSrc}`);
};

// 1. Manifest references.
const manifest = readManifest();
requireFile(manifest.background?.service_worker || '', 'manifest.background');
requireFile(manifest.action?.default_popup || '', 'manifest.action.default_popup');
requireFile(manifest.options_page || '', 'manifest.options_page');
for (const [size, icon] of Object.entries({ ...manifest.icons, ...manifest.action?.default_icon })) {
  requireFile(icon, `manifest icon ${size}`);
}
for (const entry of manifest.content_scripts || []) {
  for (const file of [...(entry.js || []), ...(entry.css || [])]) requireFile(file, 'manifest.content_scripts');
}
requireFile(`_locales/${manifest.default_locale}/messages.json`, 'manifest.default_locale');
// Chrome refuses to load an extension with any locale folder that lacks messages.json (even an empty one).
const localesDir = path.join(srcDir, '_locales');
if (existsSync(localesDir)) {
  for (const locale of readdirSync(localesDir, { withFileTypes: true })) {
    if (locale.isDirectory()) requireFile(`_locales/${locale.name}/messages.json`, `locale folder "${locale.name}"`);
  }
}

// 2. Page HTML references.
for (const html of walk(srcDir, (file) => file.endsWith('.html'))) {
  const source = readFileSync(html, 'utf8');
  for (const match of source.matchAll(/(?:src|href)="([^"#:]+)"/g)) {
    const target = path.resolve(path.dirname(html), match[1]);
    if (!existsSync(target)) errors.push(`${rel(html)} references missing ${match[1]}`);
  }
}

// 3. Module graph and layer rules.
/** Folder -> folders it must never import from. */
const FORBIDDEN_IMPORTS = {
  shared: ['background', 'storage', 'providers', 'translation', 'pages', 'content'],
  providers: ['background', 'storage', 'translation', 'pages', 'content'],
  translation: ['background', 'storage', 'pages', 'content'],
  storage: ['background', 'providers', 'translation', 'pages', 'content'],
  pages: ['background', 'storage', 'providers', 'translation', 'content'],
  background: ['pages', 'content']
};
const layerOf = (file) => toPosix(path.relative(srcDir, file)).split('/')[0];

const { classicScripts, modules } = classifySourceFiles();
for (const file of modules) {
  const source = readFileSync(file, 'utf8');
  for (const specifier of importSpecifiers(source)) {
    if (!specifier.startsWith('.')) {
      errors.push(`${rel(file)} imports bare specifier "${specifier}" (no bundler: use a relative path)`);
      continue;
    }
    if (!specifier.endsWith('.js')) errors.push(`${rel(file)} import "${specifier}" must include the .js extension`);
    const target = path.resolve(path.dirname(file), specifier);
    if (!target.startsWith(srcDir)) errors.push(`${rel(file)} imports outside src/: ${specifier}`);
    else if (!existsSync(target)) errors.push(`${rel(file)} imports missing ${specifier}`);
    else if ((FORBIDDEN_IMPORTS[layerOf(file)] || []).includes(layerOf(target))) {
      errors.push(`${rel(file)} violates layering: ${layerOf(file)}/ must not import ${layerOf(target)}/`);
    }
  }
}
for (const file of classicScripts) {
  if (/^\s*(import|export)\s/m.test(readFileSync(file, 'utf8'))) {
    errors.push(`${rel(file)} is a classic content script and must not use import/export`);
  }
}

// 4. Version parity.
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
if (manifest.version !== pkg.version)
  errors.push(`manifest version ${manifest.version} != package.json ${pkg.version}`);

if (errors.length) {
  console.error(`Extension validation failed:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(
  `Extension valid: ${modules.length} modules, ${classicScripts.length} content scripts, manifest v${manifest.version}.`
);
