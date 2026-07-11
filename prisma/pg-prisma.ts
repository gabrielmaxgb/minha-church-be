import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

export function createPgPool(connectionString = process.env.DATABASE_URL): Pool {
  if (!connectionString) {
    throw new Error('DATABASE_URL não configurada.');
  }

  return new Pool({
    connectionString,
    ssl: connectionString.includes('sslmode=require')
      ? { rejectUnauthorized: false }
      : undefined,
  });
}

export function createPrismaWithPg(pool = createPgPool()): {
  prisma: PrismaClient;
  pool: Pool;
} {
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  return { prisma, pool };
}

function migrationChecksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export async function applyMigrationsWithPg(pool: Pool): Promise<void> {
  const migrationsDir = join(__dirname, 'migrations');
  const migrationFolders = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await pool.query('GRANT ALL ON SCHEMA public TO public');

  for (const folder of migrationFolders) {
    const sqlPath = join(migrationsDir, folder, 'migration.sql');
    const sql = readFileSync(sqlPath, 'utf8');

    if (sql.trim()) {
      await pool.query(sql);
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )
  `);

  for (const folder of migrationFolders) {
    const sqlPath = join(migrationsDir, folder, 'migration.sql');
    const sql = readFileSync(sqlPath, 'utf8');

    await pool.query(
      `INSERT INTO "_prisma_migrations" (
        "id", "checksum", "finished_at", "migration_name", "logs",
        "rolled_back_at", "started_at", "applied_steps_count"
      ) VALUES ($1, $2, NOW(), $3, NULL, NULL, NOW(), 1)`,
      [randomUUID(), migrationChecksum(sql), folder],
    );
  }
}
