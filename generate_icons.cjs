const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createCrcTable() {
  const cTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) c = 0xedb88320 ^ (c >>> 1);
      else c = c >>> 1;
    }
    cTable[n] = c;
  }
  return cTable;
}

const crcTable = createCrcTable();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(12 + len);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);
  const typeAndData = buf.subarray(4, 8 + len);
  const crcVal = crc32(typeAndData);
  buf.writeUInt32BE(crcVal, 8 + len);
  return buf;
}

function generateAppIconPng(width, height, isMaskable = false) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit depth: 8
  ihdr[9] = 6; // Color type: RGBA (6)
  ihdr[10] = 0; // Compression
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // Interlace
  const ihdrChunk = makeChunk('IHDR', ihdr);

  const rowSize = 1 + width * 4;
  const rawData = Buffer.alloc(height * rowSize);

  const cx = width / 2;
  const cy = height / 2;
  const mainRadius = width * (isMaskable ? 0.38 : 0.42);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // No filter

    for (let x = 0; x < width; x++) {
      const px = rowOffset + 1 + x * 4;

      // Dark SupaChat Background (#08131A)
      let r = 8, g = 19, b = 26, a = 255;

      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Main Emerald Circle (#059669 -> #047857)
      if (dist <= mainRadius) {
        const factor = (y / height);
        r = Math.round(5 + (4 - 5) * factor);
        g = Math.round(150 + (120 - 150) * factor);
        b = Math.round(105 + (87 - 105) * factor);

        // White Chat Bubble
        const bw = width * 0.20;
        const bh = height * 0.15;
        if (Math.abs(dx) < bw && Math.abs(dy + height * 0.03) < bh) {
          r = 255; g = 255; b = 255;
        }

        // Tail of Speech Bubble
        if (dx < -width * 0.08 && dx > -width * 0.20 && dy > height * 0.08 && dy < height * 0.20 && (dx - dy < -width * 0.04)) {
          r = 255; g = 255; b = 255;
        }

        // Inner Shield/Lock motif in Emerald (#10B981)
        if (Math.abs(dx) < width * 0.07 && Math.abs(dy + height * 0.03) < height * 0.07) {
          r = 16; g = 185; b = 129;
        }
      }

      rawData[px] = r;
      rawData[px + 1] = g;
      rawData[px + 2] = b;
      rawData[px + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createIcoFromPng(pngBuffer, width = 32, height = 32) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Image type 1 = ICO
  header.writeUInt16LE(1, 4); // Number of images

  const directoryEntry = Buffer.alloc(16);
  directoryEntry[0] = width >= 256 ? 0 : width;
  directoryEntry[1] = height >= 256 ? 0 : height;
  directoryEntry[2] = 0; // Color palette
  directoryEntry[3] = 0; // Reserved
  directoryEntry.writeUInt16LE(1, 4);  // Color planes
  directoryEntry.writeUInt16LE(32, 6); // Bits per pixel
  directoryEntry.writeUInt32LE(pngBuffer.length, 8); // Size of image data
  directoryEntry.writeUInt32LE(22, 12); // Offset of image data (6 + 16 = 22)

  return Buffer.concat([header, directoryEntry, pngBuffer]);
}

function main() {
  const publicDir = path.join(__dirname, 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  const icon192 = generateAppIconPng(192, 192, false);
  const icon512 = generateAppIconPng(512, 512, false);
  const iconMaskable192 = generateAppIconPng(192, 192, true);
  const iconMaskable512 = generateAppIconPng(512, 512, true);
  const icon32 = generateAppIconPng(32, 32, false);
  const faviconIco = createIcoFromPng(icon32, 32, 32);

  fs.writeFileSync(path.join(publicDir, 'icon-192-v2.png'), icon192);
  fs.writeFileSync(path.join(publicDir, 'icon-512-v2.png'), icon512);
  fs.writeFileSync(path.join(publicDir, 'icon-maskable-192-v2.png'), iconMaskable192);
  fs.writeFileSync(path.join(publicDir, 'icon-maskable-512-v2.png'), iconMaskable512);
  fs.writeFileSync(path.join(publicDir, 'favicon.ico'), faviconIco);

  // Clean up old unversioned files if they exist
  ['icon-192.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png'].forEach((oldFile) => {
    const oldPath = path.join(publicDir, oldFile);
    if (fs.existsSync(oldPath)) {
      fs.unlinkSync(oldPath);
    }
  });

  console.log('✨ Generated pure binary PWA PNG & ICO icons successfully!');
}

main();
