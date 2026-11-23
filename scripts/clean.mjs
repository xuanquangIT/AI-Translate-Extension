/** Removes build outputs: dist/ and lingoflux-v*.zip archives at the repository root. */

import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

rmSync(path.join(root, 'dist'), { recursive: true, force: true });
for (const file of readdirSync(root)) {
  if (/^lingoflux-v.*\.zip(\.sha256)?$/.test(file)) rmSync(path.join(root, file), { force: true });
}
console.log('Cleaned dist/ and release archives.');
