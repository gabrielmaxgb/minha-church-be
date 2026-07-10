import { seedBillingTierChurches } from './seed-billing-tiers';
import { seedDatabase } from './seed';
import {
  applyMigrationsWithPg,
  createPgPool,
  createPrismaWithPg,
} from './pg-prisma';

async function main() {
  const pool = createPgPool();

  try {
    console.log('Resetando banco (driver pg, compatível com Neon)...');
    await applyMigrationsWithPg(pool);
    console.log('Migrations aplicadas.');

    const { prisma } = createPrismaWithPg(pool);
    await seedDatabase(prisma);
    await seedBillingTierChurches(prisma);
    console.log('Seed concluído: contas demo do login / senha123');
    console.log('  - Perfis: owner, admin, pastor, secretary, treasurer, leader, member');
    console.log('  - +20 membros mock na Igreja Batista Central');
    console.log('  - 4 igrejas faixa Stripe (trial expirado)');

    await prisma.$disconnect();
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
