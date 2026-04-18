// Generates placeholder icon.png, adaptive-icon.png, splash.png
// as solid-red 1024x1024 PNGs so expo prebuild stops complaining.
// Replace with real brand assets before release.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 1024;
const R = 0xff;
const G = 0x00;
const B = 0x00;
const A = 0xff;

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makePng(size) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  const rowLength = size * 4;
  const raw = Buffer.alloc(size * (rowLength + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (rowLength + 1);
    raw[rowStart] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const p = rowStart + 1 + x * 4;
      raw[p] = R;
      raw[p + 1] = G;
      raw[p + 2] = B;
      raw[p + 3] = A;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', iend),
  ]);
}

const out = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });

const png = makePng(SIZE);
for (const name of ['icon.png', 'adaptive-icon.png', 'splash.png', 'favicon.png']) {
  fs.writeFileSync(path.join(out, name), png);
  console.log('wrote', name, png.length, 'bytes');
}
