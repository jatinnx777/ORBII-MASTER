import sharp from 'sharp';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const sourceIcon = join(root, 'assets', 'icon.png');
// Adaptive-icon foreground is the same source as the legacy icon. The
// shipped `assets/adaptive-icon.png` is just a solid-red placeholder, so
// using it gave us a featureless red square on Android 8+ launchers.
// `icon.png` has the gradient + shield + wordmark with the shield+text in
// the central safe zone, which is exactly what the adaptive launcher mask
// keeps visible.
const sourceForeground = join(root, 'assets', 'icon.png');
const resDir = join(root, 'android', 'app', 'src', 'main', 'res');

// Density buckets for legacy + adaptive launcher icons.
const buckets = [
  { dir: 'mipmap-mdpi', size: 48, foreground: 108 },
  { dir: 'mipmap-hdpi', size: 72, foreground: 162 },
  { dir: 'mipmap-xhdpi', size: 96, foreground: 216 },
  { dir: 'mipmap-xxhdpi', size: 144, foreground: 324 },
  { dir: 'mipmap-xxxhdpi', size: 192, foreground: 432 },
];

async function generate() {
  for (const { dir, size, foreground } of buckets) {
    const target = join(resDir, dir);
    mkdirSync(target, { recursive: true });

    // Drop the placeholder webps so PNGs win the resource lookup.
    for (const stale of [
      'ic_launcher.webp',
      'ic_launcher_round.webp',
      'ic_launcher_foreground.webp',
    ]) {
      const path = join(target, stale);
      if (existsSync(path)) rmSync(path);
    }

    // Square legacy icon.
    await sharp(sourceIcon)
      .resize(size, size, { fit: 'cover' })
      .png({ compressionLevel: 9 })
      .toFile(join(target, 'ic_launcher.png'));

    // Round legacy icon — same source, Android masks it on pre-26 devices.
    await sharp(sourceIcon)
      .resize(size, size, { fit: 'cover' })
      .png({ compressionLevel: 9 })
      .toFile(join(target, 'ic_launcher_round.png'));

    // Adaptive icon foreground — full source fills the 432dp canvas. Android
    // crops the outer ~33% via the launcher mask, but our source art keeps
    // the shield + wordmark in the central safe zone.
    await sharp(sourceForeground)
      .resize(foreground, foreground, { fit: 'cover' })
      .png({ compressionLevel: 9 })
      .toFile(join(target, 'ic_launcher_foreground.png'));

    console.log(`[icons] ${dir} — legacy ${size}px, adaptive ${foreground}px`);
  }
}

generate().catch((err) => {
  console.error('[icons] failed', err);
  process.exit(1);
});
