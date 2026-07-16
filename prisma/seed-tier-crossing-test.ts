import { MemberStatus, PrismaClient, SubscriptionStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { seedDefaultChurchRoles } from '../src/common/permissions/seed-default-church-roles';
import { createPgPool, createPrismaWithPg } from './pg-prisma';
import {
  completePastoralProfileForIndex,
  shouldHaveCompleteProfile,
} from './seed-member-profile';

const PASSWORD = 'senha123';

/** Igreja com 99 membros — ao cadastrar o 100º ainda fica na faixa; o 101º abre o modal. */
const TIER_CROSSING_TEST_CHURCH = {
  id: 'church_billing_crossing_100',
  name: 'Igreja Teste Faixa',
  slug: 'igreja-teste-faixa-100',
  memberCount: 99,
  ownerEmail: 'owner-tier-crossing@billing.test',
  ownerName: 'Owner Tier Crossing',
} as const;

async function ensureChurch(prisma: PrismaClient) {
  const trialEndsAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  await prisma.church.upsert({
    where: { id: TIER_CROSSING_TEST_CHURCH.id },
    update: {
      name: TIER_CROSSING_TEST_CHURCH.name,
      slug: TIER_CROSSING_TEST_CHURCH.slug,
      subscriptionStatus: SubscriptionStatus.trialing,
      trialEndsAt,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripePriceId: null,
    },
    create: {
      id: TIER_CROSSING_TEST_CHURCH.id,
      name: TIER_CROSSING_TEST_CHURCH.name,
      slug: TIER_CROSSING_TEST_CHURCH.slug,
      memberCount: 0,
      subscriptionStatus: SubscriptionStatus.trialing,
      trialEndsAt,
    },
  });

  await seedDefaultChurchRoles(prisma, TIER_CROSSING_TEST_CHURCH.id);
}

async function upsertOwner(prisma: PrismaClient, passwordHash: string) {
  const emailCanonical = TIER_CROSSING_TEST_CHURCH.ownerEmail.trim().toLowerCase();

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO users (
      id, email, email_canonical, password_hash, name,
      must_change_password, email_verified_at, created_at, updated_at
    )
    VALUES (
      ${`user_${TIER_CROSSING_TEST_CHURCH.id}`},
      ${TIER_CROSSING_TEST_CHURCH.ownerEmail},
      ${emailCanonical},
      ${passwordHash},
      ${TIER_CROSSING_TEST_CHURCH.ownerName},
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
    throw new Error('Falha ao criar owner da igreja de teste de faixa.');
  }

  const membership = await prisma.churchMembership.upsert({
    where: {
      userId_churchId: {
        userId,
        churchId: TIER_CROSSING_TEST_CHURCH.id,
      },
    },
    update: { isOwner: true },
    create: {
      userId,
      churchId: TIER_CROSSING_TEST_CHURCH.id,
      isOwner: true,
    },
  });

  await prisma.churchMembershipRole.deleteMany({
    where: { membershipId: membership.id },
  });

  const memberRole = await prisma.churchRole.findFirst({
    where: { churchId: TIER_CROSSING_TEST_CHURCH.id, systemKey: 'member' },
    select: { id: true },
  });

  if (memberRole) {
    await prisma.churchMembershipRole.create({
      data: {
        membershipId: membership.id,
        roleId: memberRole.id,
      },
    });
  }

  await prisma.member.upsert({
    where: {
      churchId_email: {
        churchId: TIER_CROSSING_TEST_CHURCH.id,
        email: TIER_CROSSING_TEST_CHURCH.ownerEmail,
      },
    },
    update: {
      userId,
      name: TIER_CROSSING_TEST_CHURCH.ownerName,
      status: MemberStatus.active,
      membershipDate: new Date('2024-01-01'),
      deletedAt: null,
      ...completePastoralProfileForIndex(0),
    },
    create: {
      churchId: TIER_CROSSING_TEST_CHURCH.id,
      userId,
      name: TIER_CROSSING_TEST_CHURCH.ownerName,
      email: TIER_CROSSING_TEST_CHURCH.ownerEmail,
      status: MemberStatus.active,
      membershipDate: new Date('2024-01-01'),
      ...completePastoralProfileForIndex(0),
    },
  });

  return userId;
}

async function seedMembers(prisma: PrismaClient) {
  const placeholderCount = TIER_CROSSING_TEST_CHURCH.memberCount - 1;
  const emailPrefix = `${TIER_CROSSING_TEST_CHURCH.slug}-membro`;

  await prisma.member.deleteMany({
    where: {
      churchId: TIER_CROSSING_TEST_CHURCH.id,
      email: { not: TIER_CROSSING_TEST_CHURCH.ownerEmail },
    },
  });

  await prisma.billingTierUpgradeAcknowledgment.deleteMany({
    where: { churchId: TIER_CROSSING_TEST_CHURCH.id },
  });

  const batchSize = 200;

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
          churchId: TIER_CROSSING_TEST_CHURCH.id,
          name: `Membro ${memberNumber}`,
          email: `${emailPrefix}-${memberNumber}@billing.test`,
          status: MemberStatus.active,
          membershipDate: new Date('2024-06-01'),
          ...complete,
        };
      }),
    });
  }

  const actualCount = await prisma.member.count({
    where: {
      churchId: TIER_CROSSING_TEST_CHURCH.id,
      deletedAt: null,
      status: MemberStatus.active,
    },
  });

  await prisma.church.update({
    where: { id: TIER_CROSSING_TEST_CHURCH.id },
    data: { memberCount: actualCount },
  });

  return actualCount;
}

export async function seedTierCrossingTestChurch(prisma = new PrismaClient()) {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  await ensureChurch(prisma);
  await upsertOwner(prisma, passwordHash);
  const memberCount = await seedMembers(prisma);

  return {
    church: TIER_CROSSING_TEST_CHURCH,
    memberCount,
    password: PASSWORD,
  };
}

async function main() {
  const pool = createPgPool();
  const { prisma } = createPrismaWithPg(pool);

  try {
    const result = await seedTierCrossingTestChurch(prisma);

    console.log('Seed igreja teste faixa (99 membros) concluído.');
    console.log(`Igreja: ${result.church.name}`);
    console.log(`Membros cadastrados: ${result.memberCount}`);
    console.log(`Login: ${result.church.ownerEmail}`);
    console.log(`Senha: ${result.password}`);
    console.log('');
    console.log(
      'Próximo passo: cadastre o 100º membro ativo (sem modal) e depois o 101º ativo — ou receba/ative um visitante/inativo — para abrir o modal em /app/membros',
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

if (require.main === module) {
  void main();
}
