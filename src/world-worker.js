// Build worker for the 3D city (see src/world-build.js). The page sends the terrain and the baked
// footprints once, then asks for one chunk (or the roads) at a time and gets transferable typed
// arrays back, so building 54k buildings never blocks scrolling, clicks or the replay.
import { buildChunk, buildRoads, createFrame, readBuildings } from './world-build.js?v=30';

let frame = null, data = null;
self.onmessage = ({ data: message }) => {
  try {
    if (message.type === 'init') {
      frame = createFrame(message.terrain);
      data = readBuildings(message.buildings);
      return;
    }
    const started = performance.now();
    const { result, transfer } = message.type === 'roads' ? buildRoads(frame, message.roads, message.bridges) : buildChunk(frame, data, message.chunk);
    self.postMessage({ type: message.type, job: message.job, ms: performance.now() - started, ...result }, transfer);
  } catch (error) {
    self.postMessage({ type: 'error', job: message.job, message: String(error?.stack || error) });
  }
};
self.postMessage({ type: 'hello' });
