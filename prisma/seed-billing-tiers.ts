import { MemberStatus, PrismaClient, SubscriptionStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { seedDefaultChurchRoles } from '../src/common/permissions/seed-default-church-roles';
import { createPgPool, createPrismaWithPg } from './pg-prisma';
import {
  completePastoralProfileForIndex,
  shouldHaveCompleteProfile,
} from './seed-member-profile';

const PASSWORD = 'senha123';

/** Igrejas de teste — uma por faixa de preço Stripe. */
const BILLING_TIER_CHURCHES = [
  {
    id: 'church_billing_small',
    name: 'Igreja Tier Small (até 100)',
    slug: 'igreja-tier-small',
    memberCount: 50,
    tierLabel: 'SMALL — até 100 membros',
    ownerEmail: 'owner-tier-small@billing.test',
    ownerName: 'Owner Tier Small',
  },
  {
    id: 'church_billing_growth',
    name: 'Igreja Tier Growth (101–300)',
    slug: 'igreja-tier-growth',
    memberCount: 200,
    tierLabel: 'GROWTH — 101 a 300 membros',
    ownerEmail: 'owner-tier-growth@billing.test',
    ownerName: 'Owner Tier Growth',
  },
  {
    id: 'church_billing_consolidated',
    name: 'Igreja Tier Consolidated (301–700)',
    slug: 'igreja-tier-consolidated',
    memberCount: 500,
    tierLabel: 'CONSOLIDATED — 301 a 700 membros',
    ownerEmail: 'owner-tier-consolidated@billing.test',
    ownerName: 'Owner Tier Consolidated',
  },
  {
    id: 'church_billing_multi',
    name: 'Igreja Tier Multi (701+)',
    slug: 'igreja-tier-multi',
    memberCount: 800,
    tierLabel: 'MULTI — 701+ membros',
    ownerEmail: 'owner-tier-multi@billing.test',
    ownerName: 'Owner Tier Multi',
  },
] as const;

const expiredTrialEndsAt = new Date(Date.now() - 24 * 60 * 60 * 1000);

async function ensureBillingTierChurch(
  prisma: PrismaClient,
  church: (typeof BILLING_TIER_CHURCHES)[number],
) {
  await prisma.church.upsert({
    where: { id: church.id },
    update: {
      name: church.name,
      slug: church.slug,
      memberCount: church.memberCount,
      subscriptionStatus: SubscriptionStatus.trialing,
      trialEndsAt: expiredTrialEndsAt,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripePriceId: null,
    },
    create: {
      id: church.id,
      name: church.name,
      slug: church.slug,
      memberCount: church.memberCount,
      subscriptionStatus: SubscriptionStatus.trialing,
      trialEndsAt: expiredTrialEndsAt,
    },
  });

  await seedDefaultChurchRoles(prisma, church.id);
}

async function upsertOwner(
  prisma: PrismaClient,
  church: (typeof BILLING_TIER_CHURCHES)[number],
  passwordHash: string,
) {
  const emailCanonical = church.ownerEmail.trim().toLowerCase();

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO users (
      id, email, email_canonical, password_hash, name,
      must_change_password, email_verified_at, created_at, updated_at
    )
    VALUES (
      ${`user_${church.id}`},
      ${church.ownerEmail},
      ${emailCanonical},
      ${passwordHash},
      ${church.ownerName},
      false,
      NOW(),
      NOW(),
      NOW()
    )
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      password_hash = EXCLUDED.password_hash,
      email_canonical = EXCLUDED.email_canonical,
      email_verified_at = COALESCE(users.email_verified_at, NOW()),
      updated_at = NOW()
    RETURNING id
  `;

  const userId = rows[0]?.id;

  if (!userId) {
    throw new Error(`Falha ao criar owner para ${church.slug}`);
  }

  const membership = await prisma.churchMembership.upsert({
    where: {
      userId_churchId: {
        userId,
        churchId: church.id,
      },
    },
    update: { isOwner: true },
    create: {
      userId,
      churchId: church.id,
      isOwner: true,
    },
  });

  await prisma.churchMembershipRole.deleteMany({
    where: { membershipId: membership.id },
  });

  await prisma.member.upsert({
    where: {
      churchId_email: {
        churchId: church.id,
        email: church.ownerEmail,
      },
    },
    update: {
      userId,
      name: church.ownerName,
      status: MemberStatus.active,
      membershipDate: new Date('2024-01-01'),
      deletedAt: null,
      ...completePastoralProfileForIndex(0),
    },
    create: {
      churchId: church.id,
      userId,
      name: church.ownerName,
      email: church.ownerEmail,
      status: MemberStatus.active,
      membershipDate: new Date('2024-01-01'),
      ...completePastoralProfileForIndex(0),
    },
  });

  return { id: userId };
}

async function seedPlaceholderMembers(
  prisma: PrismaClient,
  church: (typeof BILLING_TIER_CHURCHES)[number],
) {
  const placeholderCount = Math.max(0, church.memberCount - 1);
  const batchSize = 200;

  await prisma.member.deleteMany({
    where: {
      churchId: church.id,
      email: { startsWith: `${church.slug}-membro-` },
    },
  });

  for (let offset = 0; offset < placeholderCount; offset += batchSize) {
    const size = Math.min(batchSize, placeholderCount - offset);

    await prisma.member.createMany({
      data: Array.from({ length: size }, (_, index) => {
        const memberNumber = offset + index + 1;
        const memberIndex = memberNumber - 1;
        const complete = shouldHaveCompleteProfile(
          memberIndex,
          placeholderCount,
        )
          ? completePastoralProfileForIndex(memberIndex)
          : {};

        return {
          churchId: church.id,
          name: `Membro ${memberNumber}`,
          email: `${church.slug}-membro-${memberNumber}@billing.test`,
          status: MemberStatus.active,
          membershipDate: new Date('2024-06-01'),
          ...complete,
        };
      }),
    });
  }

  const actualCount = await prisma.member.count({
    where: {
      churchId: church.id,
      deletedAt: null,
      status: MemberStatus.active,
    },
  });

  await prisma.church.update({
    where: { id: church.id },
    data: { memberCount: actualCount },
  });
}

export async function seedBillingTierChurches(prisma = new PrismaClient()) {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  for (const church of BILLING_TIER_CHURCHES) {
    await ensureBillingTierChurch(prisma, church);
    await upsertOwner(prisma, church, passwordHash);
    await seedPlaceholderMembers(prisma, church);
  }

  return BILLING_TIER_CHURCHES;
}

async function main() {
  const pool = createPgPool();
  const { prisma } = createPrismaWithPg(pool);

  try {
    const churches = await seedBillingTierChurches(prisma);

    console.log('Seed billing tiers concluído.');
    console.log(`Senha de todas as contas: ${PASSWORD}`);
    console.log('Trial expirado em todas — ideal para testar "Assinar agora".\n');

    for (const church of churches) {
      console.log(`• ${church.tierLabel}`);
      console.log(`  Igreja: ${church.name}`);
      console.log(`  Membros: ${church.memberCount}`);
      console.log(`  Login: ${church.ownerEmail}`);
      console.log('');
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

if (require.main === module) {
  void main();
}
