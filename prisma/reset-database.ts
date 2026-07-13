import { PrismaClient } from '@prisma/client';

import { seedBillingTierChurches } from './seed-billing-tiers';
import { seedTierCrossingTestChurch } from './seed-tier-crossing-test';
import { seedDatabase } from './seed';
import { applyMigrationsWithPg, createPgPool } from './pg-prisma';

async function main() {
  const pool = createPgPool();

  try {
    console.log('Resetando banco (driver pg, compatível com Neon)...');
    await applyMigrationsWithPg(pool);
    console.log('Migrations aplicadas.');
  } finally {
    await pool.end();
  }

  // Seed com engine nativo do Prisma — o adapter-pg quebra enums em create/createMany.
  const prisma = new PrismaClient();
  try {
    await seedDatabase(prisma);
    await seedBillingTierChurches(prisma);
    await seedTierCrossingTestChurch(prisma);
    console.log('Seed concluído: contas demo do login / senha123');
    console.log('  - Perfis: owner, admin, pastor, secretary, treasurer, leader, member');
    console.log('  - +20 membros mock na Igreja Batista Central');
    console.log('  - 4 igrejas faixa Stripe (trial expirado)');
    console.log('  - Igreja teste faixa (99 membros) — owner-tier-crossing@billing.test');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
