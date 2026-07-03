import { MemberStatus, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { seedDefaultChurchRoles } from '../src/common/permissions/seed-default-church-roles';

const DEMO_CHURCH_ID = 'church_demo';

const DEMO_CHURCHES = [
  {
    id: DEMO_CHURCH_ID,
    name: 'Igreja Batista Central',
    slug: 'igreja-batista-central',
  },
  {
    id: 'church_demo_norte',
    name: 'Igreja Batista do Norte',
    slug: 'igreja-batista-norte',
  },
  {
    id: 'church_demo_sul',
    name: 'Comunidade da Graça',
    slug: 'comunidade-da-graca',
  },
] as const;

const DEMO_USERS: Array<{
  email: string;
  name: string;
  isOwner?: boolean;
  systemKey?: string;
}> = [
  {
    email: 'owner@igreja.com.br',
    name: 'Proprietário Demo',
    isOwner: true,
  },
  {
    email: 'admin@igreja.com.br',
    name: 'Administrador Demo',
    systemKey: 'admin',
  },
  {
    email: 'pastor@igreja.com.br',
    name: 'Pastor Demo',
    systemKey: 'pastor',
  },
  {
    email: 'secretary@igreja.com.br',
    name: 'Secretário Demo',
    systemKey: 'secretary',
  },
  {
    email: 'treasurer@igreja.com.br',
    name: 'Tesoureiro Demo',
    systemKey: 'treasurer',
  },
  {
    email: 'leader@igreja.com.br',
    name: 'Líder Demo',
    systemKey: 'leader',
  },
  {
    email: 'member@igreja.com.br',
    name: 'Membro Demo',
    systemKey: 'member',
  },
];

async function ensureChurch(
  prisma: PrismaClient,
  church: (typeof DEMO_CHURCHES)[number],
) {
  await prisma.church.upsert({
    where: { id: church.id },
    update: {
      name: church.name,
      slug: church.slug,
    },
    create: {
      id: church.id,
      name: church.name,
      slug: church.slug,
      memberCount: 0,
    },
  });

  await seedDefaultChurchRoles(prisma, church.id);
}

async function upsertDemoUser(
  prisma: PrismaClient,
  demoUser: (typeof DEMO_USERS)[number],
  passwordHash: string,
) {
  return prisma.user.upsert({
    where: { email: demoUser.email },
    update: {
      name: demoUser.name,
      passwordHash,
    },
    create: {
      email: demoUser.email,
      name: demoUser.name,
      passwordHash,
    },
  });
}

async function upsertChurchMembership(
  prisma: PrismaClient,
  input: {
    userId: string;
    churchId: string;
    isOwner?: boolean;
    systemKey?: string;
  },
) {
  const membership = await prisma.churchMembership.upsert({
    where: {
      userId_churchId: {
        userId: input.userId,
        churchId: input.churchId,
      },
    },
    update: {
      isOwner: input.isOwner ?? false,
    },
    create: {
      userId: input.userId,
      churchId: input.churchId,
      isOwner: input.isOwner ?? false,
    },
  });

  await prisma.churchMembershipRole.deleteMany({
    where: { membershipId: membership.id },
  });

  if (input.systemKey) {
    const role = await prisma.churchRole.findFirst({
      where: {
        churchId: input.churchId,
        systemKey: input.systemKey,
      },
    });

    if (role) {
      await prisma.churchMembershipRole.create({
        data: {
          membershipId: membership.id,
          roleId: role.id,
        },
      });
    }
  }

  return membership;
}

async function upsertMemberProfile(
  prisma: PrismaClient,
  input: {
    churchId: string;
    userId: string;
    name: string;
    email: string;
  },
) {
  await prisma.member.upsert({
    where: {
      churchId_email: {
        churchId: input.churchId,
        email: input.email,
      },
    },
    update: {
      name: input.name,
      userId: input.userId,
      status: MemberStatus.active,
      membershipDate: new Date('2024-01-01'),
      deletedAt: null,
    },
    create: {
      churchId: input.churchId,
      userId: input.userId,
      name: input.name,
      email: input.email,
      status: MemberStatus.active,
      membershipDate: new Date('2024-01-01'),
    },
  });
}

async function syncChurchMemberCount(prisma: PrismaClient, churchId: string) {
  const memberCount = await prisma.member.count({
    where: {
      churchId,
      deletedAt: null,
      status: { in: [MemberStatus.active, MemberStatus.visitor] },
    },
  });

  await prisma.church.update({
    where: { id: churchId },
    data: { memberCount },
  });
}

async function seedCentralChurchUsers(prisma: PrismaClient, passwordHash: string) {
  const legacyDemo = await prisma.user.findUnique({
    where: { email: 'demo@igreja.com.br' },
  });
  const pastorAccount = await prisma.user.findUnique({
    where: { email: 'pastor@igreja.com.br' },
  });

  if (legacyDemo && !pastorAccount) {
    await prisma.user.update({
      where: { id: legacyDemo.id },
      data: { email: 'pastor@igreja.com.br', name: 'Pastor Demo' },
    });
  }

  for (const demoUser of DEMO_USERS) {
    const user = await upsertDemoUser(prisma, demoUser, passwordHash);

    await upsertChurchMembership(prisma, {
      userId: user.id,
      churchId: DEMO_CHURCH_ID,
      isOwner: demoUser.isOwner,
      systemKey: demoUser.systemKey,
    });

    await upsertMemberProfile(prisma, {
      churchId: DEMO_CHURCH_ID,
      userId: user.id,
      name: demoUser.name,
      email: demoUser.email,
    });
  }

  await syncChurchMemberCount(prisma, DEMO_CHURCH_ID);
}

async function seedSatelliteChurchAccess(
  prisma: PrismaClient,
  churchId: string,
  passwordHash: string,
  pastor: { email: string; name: string },
) {
  const owner = await prisma.user.findUniqueOrThrow({
    where: { email: 'owner@igreja.com.br' },
  });

  await upsertChurchMembership(prisma, {
    userId: owner.id,
    churchId,
    isOwner: true,
  });

  const pastorUser = await upsertDemoUser(
    prisma,
    {
      email: pastor.email,
      name: pastor.name,
      systemKey: 'pastor',
    },
    passwordHash,
  );

  await upsertChurchMembership(prisma, {
    userId: pastorUser.id,
    churchId,
    systemKey: 'pastor',
  });

  await upsertMemberProfile(prisma, {
    churchId,
    userId: pastorUser.id,
    name: pastor.name,
    email: pastor.email,
  });

  await syncChurchMemberCount(prisma, churchId);
}

export async function seedDatabase(prisma = new PrismaClient()) {
  const passwordHash = await bcrypt.hash('senha123', 10);

  for (const church of DEMO_CHURCHES) {
    await ensureChurch(prisma, church);
  }

  await seedCentralChurchUsers(prisma, passwordHash);

  await seedSatelliteChurchAccess(prisma, DEMO_CHURCHES[1].id, passwordHash, {
    email: 'pastor.norte@igreja.com.br',
    name: 'Pastor do Norte',
  });

  await seedSatelliteChurchAccess(prisma, DEMO_CHURCHES[2].id, passwordHash, {
    email: 'pastor.sul@igreja.com.br',
    name: 'Pastor do Sul',
  });
}

async function main() {
  const prisma = new PrismaClient();

  try {
    await seedDatabase(prisma);
    if (require.main === module) {
      console.log('Seed concluído: contas demo *@igreja.com.br / senha123');
      console.log('  - Igreja Batista Central: owner, admin, pastor, secretary, treasurer, leader, member');
      console.log('  - Igreja Batista do Norte: pastor.norte@igreja.com.br');
      console.log('  - Comunidade da Graça: pastor.sul@igreja.com.br');
      console.log('  - owner@igreja.com.br tem acesso às 3 igrejas');
      console.log('  - Cada conta demo também aparece no cadastro pastoral (tabela members)');
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
