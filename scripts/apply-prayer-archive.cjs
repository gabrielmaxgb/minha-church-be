// Aplica a migration prayer_request_archived_at via node-postgres (IPv4-first).
require('dns').setDefaultResultOrder('ipv4first');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const MIGRATION = '20260725000000_prayer_request_archived_at';

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/);
    if (m && !line.trim().startsWith('#')) {
      return m[1].trim();
    }
  }
  throw new Error('DATABASE_URL not found in .env');
}

async function main() {
  const connectionString = loadEnv();
  const sqlPath = path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    MIGRATION,
    'migration.sql',
  );
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const checksum = crypto
    .createHash('sha256')
    .update(fs.readFileSync(sqlPath))
    .digest('hex');

  const client = new Client({ connectionString });
  await client.connect();
  console.log('connected');

  await client.query(sql);
  console.log('sql applied');

  const existing = await client.query(
    'SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1',
    [MIGRATION],
  );

  if (existing.rowCount === 0) {
    await client.query(
      `INSERT INTO "_prisma_migrations"
        (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES ($1, $2, now(), $3, NULL, NULL, now(), 1)`,
      [crypto.randomUUID(), checksum, MIGRATION],
    );
    console.log('migration recorded');
  } else {
    console.log('migration already recorded');
  }

  await client.end();
  console.log('done');
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
