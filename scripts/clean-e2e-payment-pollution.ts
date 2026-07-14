/**
 * Remove artefatos do e2e de entitlements na igreja demo
 * (acct_e2e_entitlements + fundo e2e-dizimo).
 *
 * Uso: npx tsx scripts/clean-e2e-payment-pollution.ts
 */
import { config as loadEnv } from 'dotenv';
import { setDefaultResultOrder } from 'node:dns';

import { createPgPool, createPrismaWithPg } from '../prisma/pg-prisma';

loadEnv();
setDefaultResultOrder('ipv4first');

const CHURCH_ID = 'church_demo';
const FAKE_STRIPE_ACCOUNT = 'acct_e2e_entitlements';
const E2E_FUND_SLUG = 'e2e-dizimo';

async function main() {
  const pool = createPgPool();
  const { prisma } = createPrismaWithPg(pool);

  try {
    const account = await prisma.churchPaymentAccount.findUnique({
      where: { churchId: CHURCH_ID },
      select: { stripeAccountId: true, onboardingStatus: true },
    });
    console.log('paymentAccount before:', account);

    if (account?.stripeAccountId === FAKE_STRIPE_ACCOUNT) {
      await prisma.churchPaymentAccount.delete({ where: { churchId: CHURCH_ID } });
      console.log('deleted fake payment account');
    } else {
      console.log('no fake payment account to delete');
    }

    const fund = await prisma.givingFund.findUnique({
      where: {
        churchId_slug: { churchId: CHURCH_ID, slug: E2E_FUND_SLUG },
      },
      select: { id: true, name: true },
    });
    console.log('e2e fund before:', fund);

    if (fund) {
      const donations = await prisma.givingDonation.deleteMany({
        where: { fundId: fund.id },
      });
      await prisma.givingFund.delete({ where: { id: fund.id } });
      console.log('deleted e2e fund', { donations: donations.count });
    }

    console.log(
      'paymentAccount after:',
      await prisma.churchPaymentAccount.findUnique({
        where: { churchId: CHURCH_ID },
      }),
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
