import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

// Export the actual BrandMark geometry and brand colors; do not redraw the logo.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AUDIT_PLAYWRIGHT || 'playwright');
const root = new URL('../', import.meta.url);
const [component, css] = await Promise.all([
  readFile(new URL('src/LandingPage.tsx', root), 'utf8'),
  readFile(new URL('src/brand.css', root), 'utf8'),
]);
const symbol = component.match(/export function BrandMark[\s\S]*?<svg viewBox="0 0 40 40">([\s\S]*?)<\/svg>/)?.[1].trim();
const forest = css.match(/--brand-forest:\s*(#[\da-f]{6})/i)?.[1];
const lime = css.match(/--brand-lime:\s*(#[\da-f]{6})/i)?.[1];
if (!symbol || !forest || !lime) throw new Error('Não foi possível localizar o símbolo e as cores da marca.');
const box = Number(css.match(/\.brand-mark\s*\{[^}]*?\bwidth:\s*([\d.]+)px/)?.[1]);
const radius = Number(css.match(/\.brand-mark\s*\{[^}]*?\bborder-radius:\s*([\d.]+)px/)?.[1]);
const glyph = Number(css.match(/\.brand-mark svg\s*\{[^}]*?\bwidth:\s*([\d.]+)px/)?.[1]);
if (![box, radius, glyph].every(value => value > 0) || glyph > box) throw new Error('Dimensões da marca inválidas.');
const inset = (box - glyph) / 2;
const svg = opaque => `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">
  <rect width="${box}" height="${box}" rx="${opaque ? 0 : radius}" fill="${forest}"/>
  <svg x="${inset}" y="${inset}" width="${glyph}" height="${glyph}" viewBox="0 0 40 40" overflow="visible">
    <style>circle{fill:${lime};stroke:none}path{fill:none;stroke:${lime};stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}</style>
    ${symbol}
  </svg>
</svg>\n`;
const regular = svg(false);
const maskable = svg(true);
const icons = new URL('public/icons/', root);
await mkdir(icons, { recursive: true });
await writeFile(new URL('public/suavez-mark.svg', root), regular);
await writeFile(new URL('public/favicon.svg', root), regular);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });
const frames = new Map();
async function render(source, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><style>html,body{margin:0;padding:0;width:100%;height:100%;background:transparent}img{display:block;width:100%;height:100%}</style><img alt="" src="data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}"></html>`);
  await page.locator('img').evaluate(image => image.decode());
  return page.screenshot({ omitBackground: true });
}
try {
  for (const size of [16, 32, 48, 192, 512]) frames.set(size, await render(regular, size));
  for (const size of [192, 512]) {
    await writeFile(new URL(`suavez-v2-${size}.png`, icons), frames.get(size));
    await writeFile(new URL(`suavez-v2-maskable-${size}.png`, icons), await render(maskable, size));
  }
  await writeFile(new URL('favicon-v2-32.png', icons), frames.get(32));
  await writeFile(new URL('apple-touch-icon-v2.png', icons), await render(maskable, 180));
  // Keep the previous public URL compatible with older saved manifests.
  await writeFile(new URL('public/logo_suavez.png', root), frames.get(512));
  const sizes = [16, 32, 48];
  const directory = Buffer.alloc(6 + sizes.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  for (const [index, size] of sizes.entries()) {
    const entry = 6 + index * 16;
    directory[entry] = size; directory[entry + 1] = size;
    directory.writeUInt16LE(1, entry + 4); directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(frames.get(size).length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += frames.get(size).length;
  }
  await writeFile(new URL('public/favicon.ico', root), Buffer.concat([directory, ...sizes.map(size => frames.get(size))]));
  console.log(JSON.stringify({ brandSource: 'BrandMark', pngSizes: [32, 180, 192, 512], icoSizes: sizes, maskable: true }));
} finally { await browser.close(); }
