/**
 * LingoFlux - Build Script
 * Creates a production-ready extension package
 */

const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');
const distDir = path.join(__dirname, '..', 'dist');

// Files and folders to copy
const filesToCopy = [
  'manifest.json',
  'scripts',
  'pages',
  'assets',
  '_locales'
];

// Clean dist directory
function cleanDist() {
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true });
  }
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy files recursively
function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    const files = fs.readdirSync(src);
    for (const file of files) {
      copyRecursive(path.join(src, file), path.join(dest, file));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

async function createZip() {
  const { ZipArchive } = await import('archiver');
  const pkg = require('../package.json');
  const zipName = `lingoflux-v${pkg.version}.zip`;
  const zipPath = path.join(__dirname, '..', zipName);
  const output = fs.createWriteStream(zipPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });

  await new Promise((resolve, reject) => {
    output.on('close', () => {
      console.log(`\n📦 Created ${zipName} (${archive.pointer()} bytes)`);
      resolve();
    });
    output.on('error', reject);
    archive.on('warning', (error) => {
      if (error.code === 'ENOENT') console.warn(`⚠ ${error.message}`);
      else reject(error);
    });
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(distDir, false);
    archive.finalize().catch(reject);
  });
}

// Main build function
async function build() {
  console.log('🔨 Building LingoFlux...\n');
  
  // Clean
  cleanDist();
  console.log('✓ Cleaned dist directory');
  
  // Copy files
  for (const file of filesToCopy) {
    const srcPath = path.join(srcDir, file);
    const destPath = path.join(distDir, file);
    
    if (fs.existsSync(srcPath)) {
      copyRecursive(srcPath, destPath);
      console.log(`✓ Copied ${file}`);
    } else {
      console.log(`⚠ Skipped ${file} (not found)`);
    }
  }
  
  // Create ZIP if requested
  if (process.argv.includes('--zip')) {
    await createZip();
  }
  
  console.log('\n✅ Build complete!');
  console.log(`   Output: ${distDir}`);
}

build().catch((error) => {
  console.error(`\n❌ Build failed: ${error.message}`);
  process.exitCode = 1;
});
