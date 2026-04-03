const { drizzle } = require('drizzle-orm/postgres-js');
const postgres = require('postgres');
const { DATABASE_URL } = require('../config/env');
const schema = require('./schema');

// Strip channel_binding param — incompatible with postgres.js driver
const cleanUrl = DATABASE_URL.replace(/[&?]channel_binding=[^&]*/, '');

const client = postgres(cleanUrl, {
  max: 20,
  idle_timeout: 30,
  connect_timeout: 10,
  prepare: false, // Required for Neon's transaction-mode pooler
});

const db = drizzle(client, { schema });

module.exports = { db, client };
