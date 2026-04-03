const IORedis = require('ioredis');
const { REDIS_URL } = require('./env');

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false,
  tls: REDIS_URL.startsWith('rediss://') ? {} : undefined,
});

connection.on('error', (err) => {
  console.error('[Redis] Connection error:', err.message);
});

connection.on('connect', () => {
  console.log('[Redis] Connected');
});

module.exports = { connection };
