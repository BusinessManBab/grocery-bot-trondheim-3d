// Load and frame-rate benchmark for the 3D view, comparable across builds (old and new).
//   PLAYWRIGHT_MODULE=/path/to/playwright node tools/load_benchmark.cjs URL LABEL [--throttle 4] [--phone] [--shots DIR]
// Run it on a machine with a real GPU (Chrome flags below use ANGLE on EGL, i.e. the NVIDIA driver);
// check the printed WebGL renderer: "llvmpipe"/"SwiftShader" means software GL and meaningless fps.
// Prints one JSON line:
//   world (s)      until the 3D view is on screen (old build: everything was built by then)
//   allBuildings   until every building is resident (new build: the last chunk arrived)
//   heapPeak (MB)  peak JS heap of the page; processPeak (MB): peak RSS of renderer + GPU process
//   longest (ms)   longest main-thread task while loading; blocked (ms): sum of tasks over 50 ms
//   fps            median frame rate at the start view, the full-city overview, a street-level view,
//                  and while panning (with the worst frame, which shows shadow-redraw hitches)
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const [url, label] = process.argv.slice(2);
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1] ?? true; };
const throttle = Number(arg('--throttle', 1)), phone = process.argv.includes('--phone'), shots = arg('--shots', null);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function chromeRss() {
  // renderer + GPU process resident memory (MB), from ps; Linux only; run one benchmark at a time
  try {
    let kb = 0;
    for (const r of execFileSync('ps', ['-eo', 'rss=,args='], { encoding: 'utf8', maxBuffer: 1 << 24 }).trim().split('\n')) {
      const [rss, ...rest] = r.trim().split(/\s+/);
      if (/--type=(renderer|gpu-process)/.test(rest.join(' '))) kb += Number(rss);
    }
    return kb / 1024;
  } catch { return 0; }
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--headless=new', '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
  const result = { label, throttle, phone };
  try {
    const context = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 500)); });
    page.on('crash', () => errors.push('PAGE CRASHED'));
    await page.addInitScript(() => {
      window.__long = [];
      new PerformanceObserver(list => { for (const e of list.getEntries()) window.__long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
    });
    const cdp = await context.newCDPSession(page);
    if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    let heapPeak = 0, processPeak = 0, sampling = true;
    const sampler = (async () => {
      while (sampling) {
        try { const { usedSize } = await cdp.send('Runtime.getHeapUsage'); heapPeak = Math.max(heapPeak, usedSize / 1048576); } catch {}
        processPeak = Math.max(processPeak, chromeRss());
        await pause(100);
      }
    })();
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'commit', timeout: 120000 });
    const deadline = t0 + Number(arg('--timeout', 300)) * 1000;
    let world = null, all = null;
    while (Date.now() < deadline && !errors.includes('PAGE CRASHED')) {
      const state = await page.evaluate(() => ({ world: !!window.groceryView?.world3d, done: window.groceryView?.world3d ? (window.groceryView.world3d.cityDone ?? true) : false })).catch(() => null);
      if (state?.world && world === null) world = (Date.now() - t0) / 1000;
      if (state?.done) { all = (Date.now() - t0) / 1000; break; }
      await pause(50);
    }
    sampling = false;
    await sampler;
    Object.assign(result, { world, allBuildings: all, heapPeak: Math.round(heapPeak), processPeak: Math.round(processPeak) });
    if (all === null) { result.errors = [...errors, 'timed out']; return; }
    const info = await page.evaluate(() => {
      const w = groceryView.world3d, gl = w.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
      const long = window.__long.filter(([start]) => start < performance.now());
      return { renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown', quality: w.quality || 'n/a',
        buildings: w.buildingStats?.count, vertices: w.buildingStats?.vertices, triangles: w.buildingStats?.triangles,
        workers: w.buildingStats?.workers, longest: Math.round(Math.max(0, ...long.map(l => l[1]))),
        blocked: Math.round(long.reduce((sum, l) => sum + Math.max(0, l[1] - 50), 0)), longTasks: long.length };
    });
    Object.assign(result, info);
    await page.evaluate(() => { groceryView.play.paused = true; groceryView.play.head = 240; groceryView.panels?.closeShop?.(); });
    const fps = async (move = false) => page.evaluate(move => new Promise(resolve => {
      const w = groceryView.world3d, times = [];
      let last = 0, first = 0, angle = 0;
      const step = now => {
        if (!first) first = now;
        if (last) times.push(now - last);
        last = now;
        if (move) {          // pan in a slow circle, like dragging the map around
          angle += .02;
          w.controls.target.x += Math.cos(angle) * 18; w.controls.target.z += Math.sin(angle) * 18;
          w.camera.position.x += Math.cos(angle) * 18; w.camera.position.z += Math.sin(angle) * 18;
        }
        if (now - first < 4000) return requestAnimationFrame(step);
        times.sort((a, b) => a - b);
        resolve({ fps: Math.round(1000 / times[Math.floor(times.length / 2)]), worst: Math.round(times[times.length - 1]) });
      };
      requestAnimationFrame(step);
    }), move);
    await pause(1500);
    result.fpsStart = await fps();
    if (shots) await page.screenshot({ path: `${shots}/${label}-start.png` });
    await page.evaluate(() => groceryView.world3d.overview()); await pause(2500);
    result.fpsOverview = await fps();
    if (shots) await page.screenshot({ path: `${shots}/${label}-overview.png` });
    await page.evaluate(() => groceryView.world3d.explore(10.751, 59.921)); await pause(2500);
    result.fpsStreet = await fps();
    if (shots) await page.screenshot({ path: `${shots}/${label}-centre.png` });
    result.fpsPanning = await fps(true);
    // a fixed close-up for side-by-side comparison of the buildings
    await page.evaluate(() => {
      const w = groceryView.world3d, [x, z] = groceryView.toWorld(1074300, 5991750);
      w.controls.target.set(x, 40, z); w.camera.position.set(x - 260, 360, z + 420); w.camera.lookAt(x, 40, z);
    });
    await pause(2500);
    if (shots) await page.screenshot({ path: `${shots}/${label}-closeup.png` });
    result.errors = errors;
  } finally {
    console.log(JSON.stringify(result));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
