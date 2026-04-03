const { migrate } = require('drizzle-orm/postgres-js/migrator');
const { db, client } = require('./index');
const path = require('path');

async function runMigrations() {
  console.log('[DB] Running migrations...');
  try {
    await migrate(db, {
      migrationsFolder: path.join(__dirname, 'migrations'),
    });
    console.log('[DB] Migrations completed successfully');
  } catch (error) {
    console.error('[DB] Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations();
