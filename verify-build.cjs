const fs = require('fs');
const path = require('path');

const requiredFiles = [
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-192.png',
  'icon-maskable-512.png',
  'favicon.ico',
  'manifest.json'
];

console.log('\n--- Post-Build Bundle Verification ---');
if (!fs.existsSync('dist')) {
  console.error('❌ dist/ directory does not exist!');
  process.exit(1);
}

const distFiles = fs.readdirSync('dist');
console.log('Contents of dist/:', distFiles.join(', '));

let allValid = true;

requiredFiles.forEach(file => {
  const filePath = path.join('dist', file);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ MISSING in dist/: ${file}`);
    allValid = false;
    return;
  }
  
  const stats = fs.statSync(filePath);
  if (file.endsWith('.png')) {
    const buf = fs.readFileSync(filePath);
    const magic = buf.subarray(0, 8).toString('hex').toUpperCase();
    const isValidMagic = magic === '89504E470D0A1A0A';
    console.log(`✅ ${file} | Size: ${stats.size} bytes | Magic: ${magic} | Valid PNG: ${isValidMagic}`);
    if (!isValidMagic || stats.size === 0) allValid = false;
  } else {
    console.log(`✅ ${file} | Size: ${stats.size} bytes`);
    if (stats.size === 0) allValid = false;
  }
});

if (!allValid) {
  console.error('\n❌ Build verification failed!');
  process.exit(1);
} else {
  console.log('🎉 All icons and manifests physically verified in dist/\n');
}
