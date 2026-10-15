// Generates the app icons (star above a wave on turquoise) into public/icons and assets/images.
// Run: node scripts/make-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function starPoints(cx, cy, r, inner = 0.45) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * inner;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

// 512×512 artwork. `pad` shrinks the drawing for maskable icons (safe zone).
function svg({ pad = 0 } = {}) {
  const s = 1 - pad * 2;
  const t = 512 * pad;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#12B3C4"/>
  <g transform="translate(${t} ${t}) scale(${s})">
    <circle cx="410" cy="112" r="10" fill="#FFFFFF" opacity="0.8"/>
    <circle cx="104" cy="150" r="7" fill="#FFFFFF" opacity="0.7"/>
    <polygon points="${starPoints(432, 272, 20)}" fill="#FFFFFF" opacity="0.85"/>
    <polygon points="${starPoints(256, 222, 150)}" fill="#FFC53C" stroke="#FFC53C" stroke-width="26" stroke-linejoin="round"/>
    <polygon points="${starPoints(256, 222, 150)}" fill="none" stroke="#F2A900" stroke-width="6" stroke-linejoin="round" opacity="0.35"/>
    <path d="M0 392 Q 64 352 128 392 T 256 392 T 384 392 T 512 392 V512 H0 Z" fill="#FFFFFF"/>
    <path d="M0 436 Q 64 404 128 436 T 256 436 T 384 436 T 512 436 V512 H0 Z" fill="#0E8FA0"/>
  </g>
</svg>`;
}

const outPublic = path.join(root, 'public/icons');
fs.mkdirSync(outPublic, { recursive: true });

const full = Buffer.from(svg());
const maskable = Buffer.from(svg({ pad: 0.1 }));

await sharp(full).resize(180, 180).png().toFile(path.join(outPublic, 'apple-touch-icon.png'));
await sharp(full).resize(192, 192).png().toFile(path.join(outPublic, 'icon-192.png'));
await sharp(full).resize(512, 512).png().toFile(path.join(outPublic, 'icon-512.png'));
await sharp(maskable).resize(512, 512).png().toFile(path.join(outPublic, 'icon-maskable-512.png'));
await sharp(full).resize(1024, 1024).png().toFile(path.join(root, 'assets/images/icon.png'));
await sharp(full).resize(48, 48).png().toFile(path.join(root, 'assets/images/favicon.png'));
fs.writeFileSync(path.join(root, 'assets/images/icon.svg'), svg());
console.log('icons written');
