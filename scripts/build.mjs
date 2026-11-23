/**
 * Builds the unpacked extension into dist/ (a verbatim copy of src/) and, with
 * --zip, a release archive lingoflux-v<version>.zip at the repository root.
 * src/ needs no compilation: it is plain MV3 JavaScript.
 */

import { cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const distDir = path.join(root, 'dist');

/** Files never shipped in the package. */
const EXCLUDED = [/\.md$/i, /(^|[\\/])\.DS_Store$/, /(^|[\\/])Thumbs\.db$/];

function copySource() {
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });
  cpSync(srcDir, distDir, {
    recursive: true,
    filter: (source) => !EXCLUDED.some((pattern) => pattern.test(source))
  });
}

async function createZip() {
  const { ZipArchive } = await import('archiver');
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const zipName = `lingoflux-v${version}.zip`;
  const output = createWriteStream(path.join(root, zipName));
  const archive = new ZipArchive({ zlib: { level: 9 } });

  await new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('warning', (error) => (error.code === 'ENOENT' ? console.warn(error.message) : reject(error)));
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(distDir, false);
    archive.finalize().catch(reject);
  });
  console.log(`Created ${zipName} (${archive.pointer()} bytes)`);
}

async function build() {
  if (!existsSync(path.join(srcDir, 'manifest.json'))) throw new Error('src/manifest.json not found.');
  copySource();
  console.log(`Built ${path.relative(root, distDir)}/ from src/`);
  if (process.argv.includes('--zip')) await createZip();
}

build().catch((error) => {
  console.error(`Build failed: ${error.message}`);
  process.exitCode = 1;
});
