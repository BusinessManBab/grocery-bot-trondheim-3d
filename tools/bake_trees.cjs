// Plants the forest and park trees once and writes data/trees.bin (see src/forest.js).
//   PLAYWRIGHT_MODULE=/path/to/playwright node tools/bake_trees.cjs
// Needs any Chromium; no GPU (it is Canvas2D only). Re-run after changing roads, buildings,
// land cover or shop positions.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    page.on('pageerror', error => { console.error(error); process.exitCode = 1; });
    await page.route('http://bake.local/**', route => {
      const file = path.join(ROOT, decodeURIComponent(new URL(route.request().url()).pathname));
      if (!file.startsWith(ROOT) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      route.fulfill({ path: file, contentType: TYPES[path.extname(file)] || 'application/octet-stream' });
    });
    // fingerprint of the inputs, so tools/check_preview.py can tell when the bake is stale
    const source = crypto.createHash('sha256');
    for (const file of ['game-map.json', 'buildings.json', 'landcover.json', 'game.json']) source.update(fs.readFileSync(path.join(ROOT, 'data', file)));
    await page.goto(`http://bake.local/tools/bake-trees.html?source=${source.digest('hex').slice(0, 16)}`);
    const baked = await page.waitForFunction(() => window.baked, null, { timeout: 300000 }).then(handle => handle.jsonValue());
    const buffer = Buffer.from(baked.base64, 'base64');
    fs.writeFileSync(path.join(ROOT, 'data', 'trees.bin'), buffer);
    console.log(`trees.bin: ${baked.forest} forest trees (${baked.spruce} spruce), ${baked.parks} park trees, ${buffer.length} bytes`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
