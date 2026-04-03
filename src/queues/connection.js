const { connection } = require('../config/redis');

// Shared connection config for BullMQ queues and workers
// BullMQ needs maxRetriesPerRequest: null on the IORedis connection
module.exports = { connection };
