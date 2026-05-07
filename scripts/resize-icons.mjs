// One-off icon downscaler. Reads assets/icon.png and writes properly-sized
// PNGs into every Android mipmap and drawable density bucket so the APK
// doesn't carry the 2048x2048 master 15 times.

import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const src = readFileSync(resolve(root, 'assets/icon.png'));

// Android launcher icon dimensions per density (square).
const LAUNCHER_SIZES = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

// Expo splash logo target widths. Splash logo is rendered larger than the
// launcher icon but doesn't need 2048. 512 max keeps the APK lean while
// preserving sharp edges on xxxhdpi screens.
const SPLASH_SIZES = {
  'drawable-mdpi': 192,
  'drawable-hdpi': 288,
  'drawable-xhdpi': 384,
  'drawable-xxhdpi': 432,
  'drawable-xxxhdpi': 512,
};

async function writeLauncher(dir, size) {
  const out = resolve(root, 'android/app/src/main/res', dir);
  for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
    await sharp(src)
      .resize(size, size, { fit: 'contain', background: { r: 149, g: 213, b: 178, alpha: 1 } })
      .png({ compressionLevel: 9 })
      .toFile(resolve(out, name));
  }
  console.log(`launcher ${dir} (${size}px) ✓`);
}

async function writeSplash(dir, size) {
  const out = resolve(root, 'android/app/src/main/res', dir, 'splashscreen_logo.png');
  await sharp(src)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`splash ${dir} (${size}px) ✓`);
}

(async () => {
  for (const [dir, size] of Object.entries(LAUNCHER_SIZES)) await writeLauncher(dir, size);
  for (const [dir, size] of Object.entries(SPLASH_SIZES)) await writeSplash(dir, size);

  // Also shrink the assets/* masters used by the JS bundle / About logo.
  // Keep at 1024 — Expo splash on iOS / web reads from these.
  await sharp(src)
    .resize(1024, 1024, { fit: 'contain' })
    .png({ compressionLevel: 9 })
    .toFile(resolve(root, 'assets/adaptive-icon.png'));
  await sharp(src)
    .resize(1024, 1024, { fit: 'contain' })
    .png({ compressionLevel: 9 })
    .toFile(resolve(root, 'assets/splash.png'));
  console.log('assets/* (1024px) ✓');
})();
