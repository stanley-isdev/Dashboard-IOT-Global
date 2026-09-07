// Cuts the orange infinity out of the brand lockup and writes it out as the
// tab icon.
//
// Why this exists: the tab was still showing Vite's purple lightning bolt, and
// the mark that belongs there is already in the repo - it is the left quarter
// of public/brand/one-stanley-narong-pat-global.png, the same artwork the
// masthead draws. Cropping it here rather than by hand keeps the icon and the
// masthead on one source file: re-supply the lockup, re-run this, and the tab
// follows.
//
// The wordmark is deliberately dropped. At 16px it is a grey smear, and the
// infinity alone is what reads at that size.
//
// Chromium does the pixel work (via the playwright already in devDependencies)
// because nothing else here decodes or resamples a PNG - no sharp, no jimp.
//
// Run: npm run gen:favicon
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const source = resolve(root, 'public/brand/one-stanley-narong-pat-global.png');

// The sizes browsers actually ask for. 32 is the tab and the bookmark bar, 180
// is what iOS wants for a home-screen tile, 512 is the one an installed PWA or
// a high-DPI tab picks up. All three come off the same crop, resampled by
// Chromium, so they cannot drift apart.
const outputs = [
  { file: 'public/favicon-32.png', size: 32 },
  { file: 'public/favicon-180.png', size: 180 },
  { file: 'public/favicon-512.png', size: 512 },
];

const dataUri = `data:image/png;base64,${(await readFile(source)).toString('base64')}`;

const browser = await chromium.launch();
const page = await browser.newPage();

const result = await page.evaluate(
  async ({ dataUri, outputs }) => {
    const img = new Image();
    img.src = dataUri;
    await img.decode();

    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const src = document.createElement('canvas');
    src.width = w;
    src.height = h;
    const sctx = src.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(img, 0, 0);
    const { data } = sctx.getImageData(0, 0, w, h);

    // The artwork is cropped to its ink and transparent, so "is there anything
    // in this column" is just an alpha test. A low threshold rather than
    // alpha > 0: the edges of the drawing are antialiased, and a stray pixel at
    // alpha 3 is not part of the mark.
    const inked = [];
    for (let x = 0; x < w; x++) {
      let any = false;
      for (let y = 0; y < h; y++) {
        if (data[(y * w + x) * 4 + 3] > 8) {
          any = true;
          break;
        }
      }
      inked.push(any);
    }

    // The mark is the first run of inked columns. The gutter between it and the
    // wordmark is the first empty run wide enough not to be the gap inside a
    // letterform - 2% of the width, which at 1883px is 37px.
    const gutter = Math.max(8, Math.round(w * 0.02));
    let left = inked.indexOf(true);
    if (left < 0) throw new Error('the source artwork is entirely transparent');
    let right = left;
    for (let x = left; x < w; x++) {
      if (inked[x]) {
        right = x;
        continue;
      }
      let run = 0;
      while (x + run < w && !inked[x + run]) run++;
      if (run >= gutter) break;
      x += run - 1;
    }

    // Vertical extent of that crop only, so the square is centred on the
    // infinity rather than on the taller wordmark block.
    let top = h;
    let bottom = -1;
    for (let y = 0; y < h; y++) {
      for (let x = left; x <= right; x++) {
        if (data[(y * w + x) * 4 + 3] > 8) {
          if (y < top) top = y;
          if (y > bottom) bottom = y;
          break;
        }
      }
    }

    const cw = right - left + 1;
    const ch = bottom - top + 1;

    const files = {};
    for (const { file, size } of outputs) {
      const out = document.createElement('canvas');
      out.width = size;
      out.height = size;
      const octx = out.getContext('2d');
      octx.imageSmoothingQuality = 'high';

      // Fitted by width, not by the longer side. An infinity is about twice as
      // wide as it is tall, so fitting the whole box inside the square would
      // leave it half the height of the icon and reading as small. 94% of the
      // width keeps a hair of margin off the edge; the leftover height is
      // transparent, top and bottom.
      const dw = Math.round(size * 0.94);
      const dh = Math.round((dw * ch) / cw);
      octx.drawImage(img, left, top, cw, ch, Math.round((size - dw) / 2), Math.round((size - dh) / 2), dw, dh);

      files[file] = out.toDataURL('image/png').split(',')[1];
    }

    return { crop: { left, top, width: cw, height: ch }, source: { w, h }, files };
  },
  { dataUri, outputs },
);

await browser.close();

const { crop, source: dims } = result;
console.log(`Source ${dims.w}x${dims.h}`);
console.log(`Mark at x=${crop.left} y=${crop.top}, ${crop.width}x${crop.height}`);
for (const [file, base64] of Object.entries(result.files)) {
  const bytes = Buffer.from(base64, 'base64');
  await writeFile(resolve(root, file), bytes);
  console.log(`Wrote ${file} (${(bytes.length / 1024).toFixed(1)} kB)`);
}
