import { seedBillingTierChurches } from './seed-billing-tiers';
import { seedTierCrossingTestChurch } from './seed-tier-crossing-test';
import { seedDatabase } from './seed';
import { applyMigrationsWithPg, createPrismaWithPg, createPgPool } from './pg-prisma';

async function main() {
  const migratePool = createPgPool();

  try {
    console.log('Resetando banco (driver pg, compatível com Neon)...');
    await applyMigrationsWithPg(migratePool);
    console.log('Migrations aplicadas.');
  } finally {
    await migratePool.end();
  }

  // Seed também via adapter pg: o engine nativo do Prisma falha com P1001 no
  // endpoint Neon sa-east-1 (resolve IPv6 primeiro e a máquina não tem rota).
  const { prisma, pool } = createPrismaWithPg();
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
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
