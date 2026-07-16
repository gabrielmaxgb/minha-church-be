// Aplica migrations de recebimentos / fundos via node-postgres (IPv4).
require('dns').setDefaultResultOrder('ipv4first');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const MIGRATIONS = [
  '20260725000000_receivables_manage_permission',
  '20260725010000_giving_fund_audience_and_donor',
];

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

async function applyOne(client, name) {
  const sqlPath = path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    name,
    'migration.sql',
  );
  const sqlBytes = fs.readFileSync(sqlPath);
  const checksum = crypto.createHash('sha256').update(sqlBytes).digest('hex');

  const existing = await client.query(
    'SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1',
    [name],
  );

  if (existing.rowCount > 0) {
    console.log(`${name}: already recorded`);
    return;
  }

  await client.query(sqlBytes.toString('utf8'));
  await client.query(
    `INSERT INTO "_prisma_migrations"
      (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
     VALUES ($1, $2, now(), $3, NULL, NULL, now(), 1)`,
    [crypto.randomUUID(), checksum, name],
  );
  console.log(`${name}: applied + recorded`);
}

async function main() {
  const client = new Client({ connectionString: loadEnv() });
  await client.connect();
  console.log('connected');

  for (const name of MIGRATIONS) {
    await applyOne(client, name);
  }

  await client.end();
  console.log('done');
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
