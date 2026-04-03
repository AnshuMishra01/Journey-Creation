/**
 * Worker process entry point.
 * Run separately from the Express server: `node worker.js`
 * Or in dev mode, set ENABLE_WORKERS=true and it starts with the server.
 */
require('dotenv').config();

console.log('[Workers] Starting all pipeline workers...');

const workers = [
  require('./src/queues/workers/conceptExtraction.worker'),
  require('./src/queues/workers/scriptGeneration.worker'),
  require('./src/queues/workers/questionGeneration.worker'),
  require('./src/queues/workers/flashcardGeneration.worker'),
  require('./src/queues/workers/audioGeneration.worker'),
  require('./src/queues/workers/finalize.worker'),
];

console.log(`[Workers] ${workers.length} workers started and listening for jobs`);

// Graceful shutdown
async function shutdown() {
  console.log('[Workers] Shutting down...');
  await Promise.all(workers.map(w => w.close()));
  console.log('[Workers] All workers closed');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
