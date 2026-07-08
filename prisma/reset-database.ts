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
    console.log('Seed concluído: contas demo *@igreja.com.br / senha123');

    await prisma.$disconnect();
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
