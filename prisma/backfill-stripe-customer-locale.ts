/**
 * Backfill preferred_locales=pt-BR em todos os Stripe customers
 * vinculados a igrejas no banco.
 *
 * Uso:
 *   npm run db:backfill:stripe-locale
 *
 * Requer STRIPE_SECRET_KEY e DATABASE_URL no .env.
 */
import Stripe from 'stripe';

import { createPgPool, createPrismaWithPg } from './pg-prisma';

async function main() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();

  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY não configurada.');
  }

  const stripe = new Stripe(secretKey);
  const pool = createPgPool();
  const { prisma } = createPrismaWithPg(pool);

  try {
    const churches = await prisma.church.findMany({
      where: { stripeCustomerId: { not: null } },
      select: {
        id: true,
        name: true,
        stripeCustomerId: true,
      },
      orderBy: { name: 'asc' },
    });

    console.log(
      `Encontradas ${churches.length} igreja(s) com stripeCustomerId.`,
    );

    let ok = 0;
    let failed = 0;

    for (const church of churches) {
      const customerId = church.stripeCustomerId;

      if (!customerId) {
        continue;
      }

      try {
        await stripe.customers.update(customerId, {
          preferred_locales: ['pt-BR'],
        });
        ok += 1;
        console.log(`OK  ${church.name} (${customerId})`);
      } catch (error) {
        failed += 1;
        const message =
          error instanceof Error ? error.message : 'erro desconhecido';
        console.error(`ERR ${church.name} (${customerId}): ${message}`);
      }
    }

    console.log(`Concluído. ok=${ok} failed=${failed}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
