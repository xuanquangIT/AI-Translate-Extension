/**
 * LingoFlux - Clean Script
 * Removes build artifacts
 */

const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');

if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true });
  console.log('✓ Cleaned dist directory');
} else {
  console.log('Nothing to clean');
}
