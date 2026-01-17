#!/usr/bin/env node

/**
 * Generate PNG favicons from SVG
 * Run: node scripts/generate-favicons.js
 * Requires: npm install sharp (dev dependency)
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const publicDir = join(__dirname, '..', 'public');
const svgPath = join(publicDir, 'favicon.svg');

const sizes = [
  { name: 'favicon-16x16.png', size: 16 },
  { name: 'favicon-32x32.png', size: 32 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
];

async function generateFavicons() {
  console.log('Generating favicons from SVG...');

  const svgBuffer = readFileSync(svgPath);

  for (const { name, size } of sizes) {
    const outputPath = join(publicDir, name);

    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outputPath);

    console.log(`  Created: ${name} (${size}x${size})`);
  }

  // Generate OG image (1200x630)
  const ogImagePath = join(publicDir, 'og-image.png');

  // Create OG image with padding and branding
  const ogWidth = 1200;
  const ogHeight = 630;
  const iconSize = 300;

  const iconBuffer = await sharp(svgBuffer)
    .resize(iconSize, iconSize)
    .png()
    .toBuffer();

  // Create background and composite
  await sharp({
    create: {
      width: ogWidth,
      height: ogHeight,
      channels: 4,
      background: { r: 10, g: 14, b: 23, alpha: 1 } // #0a0e17
    }
  })
    .composite([
      {
        input: iconBuffer,
        left: Math.floor((ogWidth - iconSize) / 2),
        top: 80
      },
      {
        input: Buffer.from(`
          <svg width="${ogWidth}" height="${ogHeight}">
            <style>
              .title { fill: #e1e5eb; font-size: 64px; font-family: sans-serif; font-weight: bold; }
              .subtitle { fill: #8b949e; font-size: 32px; font-family: sans-serif; }
            </style>
            <text x="50%" y="480" text-anchor="middle" class="title">Signal Sense Hunter</text>
            <text x="50%" y="540" text-anchor="middle" class="subtitle">Real-Time Crypto Volatility Scanner</text>
          </svg>
        `),
        top: 0,
        left: 0
      }
    ])
    .png()
    .toFile(ogImagePath);

  console.log(`  Created: og-image.png (${ogWidth}x${ogHeight})`);
  console.log('Done!');
}

generateFavicons().catch(console.error);
