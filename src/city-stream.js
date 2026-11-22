// Runs the city build jobs (src/world-build.js) in a few module workers: the roads first, then the
// building chunks nearest to the camera first. Each finished job comes back as transferable typed
// arrays and is added to the scene at once, so the city fills in around you within moments while
// the page stays responsive. Browsers without module workers build on the page instead, one job
// at a time between frames.
const WORKER_URL = new URL('./world-worker.js?v=30', import.meta.url);

/**
 * @param jobs [{ type: 'roads', roads, bridges } | { type: 'chunk', chunk }] in the order wanted
 * @param terrain { bounds, cols, rows, heights }; @param buildings ArrayBuffer of data/buildings.bin
 * @param onResult (message) => void, called on the page for each finished job
 * @returns Promise that resolves once every job is done: { workers, ms }
 */
export function streamCity({ jobs, terrain, buildings, onResult }) {
  const started = performance.now();
  const memory = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 4;
  const size = Math.max(1, Math.min(memory <= 2 ? 2 : 4, cores - 1, jobs.length));
  const queue = jobs.map((job, i) => ({ ...job, job: i }));
  let left = queue.length, fallback = null, finish, fail;
  const done = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  const workers = [];

  const settle = message => {
    try { onResult(message); } catch (error) { fail(error); return; }
    if (--left === 0) {
      for (const w of workers) w.worker.terminate();
      finish({ workers: fallback ? 0 : workers.length, ms: performance.now() - started });
    }
  };

  // on the page: one job, then let a frame through
  async function onPage() {
    if (fallback) return;
    fallback = import('./world-build.js?v=30').then(async ({ buildChunk, buildRoads, createFrame, readBuildings }) => {
      const frame = createFrame(terrain), data = readBuildings(buildings);
      for (const w of workers) { w.worker.terminate(); if (w.job) queue.unshift(w.job); }
      workers.length = 0;
      while (queue.length) {
        const job = queue.shift();
        const { result } = job.type === 'roads' ? buildRoads(frame, job.roads, job.bridges) : buildChunk(frame, data, job.chunk);
        settle({ type: job.type, job: job.job, ...result });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }).catch(fail);
  }

  function next(w) {
    w.job = queue.shift() || null;
    if (w.job) w.worker.postMessage(w.job);
  }

  if (typeof Worker === 'undefined') onPage();
  else {
    try {
      for (let i = 0; i < size; i++) {
        const worker = new Worker(WORKER_URL, { type: 'module' }), w = { worker, job: null, ready: false };
        workers.push(w);
        worker.onmessage = ({ data }) => {
          if (data.type === 'hello') { w.ready = true; next(w); return; }
          if (data.type === 'error') { console.error('City build worker:', data.message); onPage(); return; }
          w.job = null;
          next(w);
          settle(data);
        };
        // a browser that cannot run module workers fails here, before 'hello'
        worker.onerror = event => { event.preventDefault?.(); console.warn('City build worker unavailable, building on the page', event.message || ''); onPage(); };
        worker.postMessage({ type: 'init', terrain, buildings });
      }
    } catch (error) {
      console.warn('City build workers unavailable, building on the page', error);
      onPage();
    }
  }
  return done;
}
