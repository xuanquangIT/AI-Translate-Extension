/**
 * Creates (or removes) a Windows desktop shortcut that starts the local MT stack in the system tray
 * (scripts/local-mt/tray.ps1). The shortcut icon is built from src/assets/icons/icon128.png into
 * .local-mt/lingoflux-local-mt.ico (git-ignored).
 *
 * Usage: node scripts/local-mt/shortcut.mjs [--startup] [--remove]
 *   --startup  also add the shortcut to the Windows Startup folder (start with Windows)
 *   --remove   delete the shortcut(s) instead
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LOCAL_MT_DIR, ROOT } from './paths.mjs';

export const SHORTCUT_NAME = 'LingoFlux Local MT.lnk';

/** Wraps one PNG image in an .ico container (PNG-compressed icons are supported since Windows Vista). */
export function buildIcoFromPng(png) {
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error('Icon source is not a PNG file.');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // image count
  header.writeUInt8(width >= 256 ? 0 : width, 6);
  header.writeUInt8(height >= 256 ? 0 : height, 7);
  header.writeUInt8(0, 8); // palette colors
  header.writeUInt8(0, 9); // reserved
  header.writeUInt16LE(1, 10); // color planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18); // image data offset
  return Buffer.concat([header, png]);
}

function powershell(script, env) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, ...env },
    encoding: 'utf8'
  }).trim();
}

function main() {
  if (process.platform !== 'win32') {
    console.error('Desktop shortcuts are Windows only. Run `npm run local-mt:start` instead.');
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const folders = JSON.parse(
    powershell(
      "@{ desktop = [Environment]::GetFolderPath('Desktop'); startup = [Environment]::GetFolderPath('Startup') } | ConvertTo-Json"
    )
  );
  const targets = [path.join(folders.desktop, SHORTCUT_NAME)];
  if (args.includes('--startup')) targets.push(path.join(folders.startup, SHORTCUT_NAME));

  if (args.includes('--remove')) {
    const removeTargets = [path.join(folders.desktop, SHORTCUT_NAME), path.join(folders.startup, SHORTCUT_NAME)];
    powershell('$env:LF_TARGETS -split [char]10 | Where-Object { Test-Path $_ } | Remove-Item', {
      LF_TARGETS: removeTargets.join('\n')
    });
    console.log('Removed LingoFlux Local MT shortcuts (desktop and Startup).');
    return;
  }

  mkdirSync(LOCAL_MT_DIR, { recursive: true });
  const icon = path.join(LOCAL_MT_DIR, 'lingoflux-local-mt.ico');
  writeFileSync(icon, buildIcoFromPng(readFileSync(path.join(ROOT, 'src', 'assets', 'icons', 'icon128.png'))));

  const tray = path.join(ROOT, 'scripts', 'local-mt', 'tray.ps1');
  for (const target of targets) {
    powershell(
      [
        '$shell = New-Object -ComObject WScript.Shell',
        '$link = $shell.CreateShortcut($env:LF_TARGET)',
        "$link.TargetPath = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'",
        '$link.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$env:LF_TRAY`""',
        '$link.WorkingDirectory = $env:LF_ROOT',
        '$link.IconLocation = "$env:LF_ICON,0"',
        '$link.WindowStyle = 7',
        "$link.Description = 'Start LingoFlux local GPU translation in the system tray'",
        '$link.Save()'
      ].join('; '),
      { LF_TARGET: target, LF_TRAY: tray, LF_ROOT: ROOT, LF_ICON: icon }
    );
    console.log(`Created shortcut: ${target}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
