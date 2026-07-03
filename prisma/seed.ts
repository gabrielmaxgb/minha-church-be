import {
  PrismaClient,
  MemberStatus,
  MaritalStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { seedDefaultChurchRoles } from '../src/common/permissions/seed-default-church-roles';

async function assignMemberToMinistry(
  prisma: PrismaClient,
  memberId: string,
  ministryId: string,
  roleIds: string[] = [],
  startedAt = new Date(),
) {
  const link = await prisma.memberMinistry.upsert({
    where: {
      memberId_ministryId: {
        memberId,
        ministryId,
      },
    },
    update: {
      endedAt: null,
    },
    create: {
      memberId,
      ministryId,
      startedAt,
    },
  });

  await prisma.memberMinistryRole.deleteMany({
    where: { memberMinistryId: link.id },
  });

  if (roleIds.length > 0) {
    await prisma.memberMinistryRole.createMany({
      data: roleIds.map((ministryRoleId) => ({
        memberMinistryId: link.id,
        ministryRoleId,
      })),
    });
  }
}

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

async function seedCentralChurch(prisma: PrismaClient, passwordHash: string) {
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
  }

  const pastorUser = await prisma.user.findUniqueOrThrow({
    where: { email: 'pastor@igreja.com.br' },
  });

  const leaderUser = await prisma.user.findUniqueOrThrow({
    where: { email: 'leader@igreja.com.br' },
  });

  const worshipMinistry = await prisma.ministry.upsert({
    where: {
      churchId_name: {
        churchId: DEMO_CHURCH_ID,
        name: 'Louvor',
      },
    },
    update: {
      description: 'Ministério de louvor e adoração',
      isActive: true,
    },
    create: {
      churchId: DEMO_CHURCH_ID,
      name: 'Louvor',
      description: 'Ministério de louvor e adoração',
    },
  });

  const worshipLeaderRole = await prisma.ministryRole.upsert({
    where: {
      ministryId_name: {
        ministryId: worshipMinistry.id,
        name: 'Regente',
      },
    },
    update: {
      canManageEvents: true,
      sortOrder: 1,
    },
    create: {
      ministryId: worshipMinistry.id,
      name: 'Regente',
      canManageEvents: true,
      sortOrder: 1,
    },
  });

  await prisma.ministryRole.upsert({
    where: {
      ministryId_name: {
        ministryId: worshipMinistry.id,
        name: 'Vocalista',
      },
    },
    update: { sortOrder: 2 },
    create: {
      ministryId: worshipMinistry.id,
      name: 'Vocalista',
      sortOrder: 2,
    },
  });

  const cellsMinistry = await prisma.ministry.upsert({
    where: {
      churchId_name: {
        churchId: DEMO_CHURCH_ID,
        name: 'Células',
      },
    },
    update: { isActive: true },
    create: {
      churchId: DEMO_CHURCH_ID,
      name: 'Células',
      description: 'Ministério de células e discipulado',
    },
  });

  await prisma.ministryRole.upsert({
    where: {
      ministryId_name: {
        ministryId: cellsMinistry.id,
        name: 'Líder de célula',
      },
    },
    update: { canManageEvents: true, sortOrder: 1 },
    create: {
      ministryId: cellsMinistry.id,
      name: 'Líder de célula',
      canManageEvents: true,
      sortOrder: 1,
    },
  });

  const memberAna = await prisma.member.upsert({
    where: {
      churchId_email: {
        churchId: DEMO_CHURCH_ID,
        email: 'ana.silva@igreja.com.br',
      },
    },
    update: {
      name: 'Ana Silva',
      status: MemberStatus.active,
      maritalStatus: MaritalStatus.married,
      weddingAnniversary: new Date('2018-06-15'),
      membershipDate: new Date('2021-03-10'),
    },
    create: {
      churchId: DEMO_CHURCH_ID,
      name: 'Ana Silva',
      email: 'ana.silva@igreja.com.br',
      phone: '11999990001',
      status: MemberStatus.active,
      maritalStatus: MaritalStatus.married,
      weddingAnniversary: new Date('2018-06-15'),
      membershipDate: new Date('2021-03-10'),
      baptismDate: new Date('2020-11-20'),
    },
  });

  const memberCarlos = await prisma.member.upsert({
    where: {
      churchId_email: {
        churchId: DEMO_CHURCH_ID,
        email: 'carlos.mendes@igreja.com.br',
      },
    },
    update: {
      name: 'Carlos Mendes',
      status: MemberStatus.active,
      membershipDate: new Date('2019-01-08'),
    },
    create: {
      churchId: DEMO_CHURCH_ID,
      name: 'Carlos Mendes',
      email: 'carlos.mendes@igreja.com.br',
      phone: '11999990002',
      status: MemberStatus.active,
      membershipDate: new Date('2019-01-08'),
    },
  });

  await prisma.member.upsert({
    where: {
      churchId_email: {
        churchId: DEMO_CHURCH_ID,
        email: 'maria.visitante@igreja.com.br',
      },
    },
    update: {
      name: 'Maria Santos',
      status: MemberStatus.visitor,
      visitorSince: new Date('2025-12-01'),
    },
    create: {
      churchId: DEMO_CHURCH_ID,
      name: 'Maria Santos',
      email: 'maria.visitante@igreja.com.br',
      phone: '11999990003',
      status: MemberStatus.visitor,
      visitorSince: new Date('2025-12-01'),
    },
  });

  await assignMemberToMinistry(
    prisma,
    memberAna.id,
    worshipMinistry.id,
    [worshipLeaderRole.id],
    new Date('2021-04-01'),
  );

  await assignMemberToMinistry(
    prisma,
    memberCarlos.id,
    cellsMinistry.id,
    [],
    new Date('2019-02-01'),
  );

  const leaderMember = await prisma.member.upsert({
    where: {
      churchId_email: {
        churchId: DEMO_CHURCH_ID,
        email: 'leader@igreja.com.br',
      },
    },
    update: {
      name: 'Líder Demo',
      userId: leaderUser.id,
      status: MemberStatus.active,
      membershipDate: new Date('2022-01-15'),
    },
    create: {
      churchId: DEMO_CHURCH_ID,
      userId: leaderUser.id,
      name: 'Líder Demo',
      email: 'leader@igreja.com.br',
      status: MemberStatus.active,
      membershipDate: new Date('2022-01-15'),
    },
  });

  await assignMemberToMinistry(
    prisma,
    leaderMember.id,
    worshipMinistry.id,
    [worshipLeaderRole.id],
    new Date('2022-02-01'),
  );

  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  nextMonth.setHours(19, 0, 0, 0);

  await prisma.ministryEvent.upsert({
    where: { id: 'event_demo_louvorzao' },
    update: {
      name: 'Louvorzão',
      description: 'Noite especial de adoração com toda a igreja',
      location: 'Templo principal',
      startsAt: nextMonth,
      deletedAt: null,
    },
    create: {
      id: 'event_demo_louvorzao',
      churchId: DEMO_CHURCH_ID,
      ministryId: worshipMinistry.id,
      name: 'Louvorzão',
      description: 'Noite especial de adoração com toda a igreja',
      location: 'Templo principal',
      startsAt: nextMonth,
      createdByUserId: pastorUser.id,
    },
  });

  const conferenceDate = new Date();
  conferenceDate.setDate(conferenceDate.getDate() + 14);
  conferenceDate.setHours(10, 0, 0, 0);

  await prisma.ministryEvent.upsert({
    where: { id: 'event_demo_conferencia' },
    update: {
      name: 'Conferência da Família',
      description: 'Encontro especial para toda a igreja — destaque no painel',
      location: 'Auditório principal',
      startsAt: conferenceDate,
      ministryId: null,
      deletedAt: null,
    },
    create: {
      id: 'event_demo_conferencia',
      churchId: DEMO_CHURCH_ID,
      ministryId: null,
      name: 'Conferência da Família',
      description: 'Encontro especial para toda a igreja — destaque no painel',
      location: 'Auditório principal',
      startsAt: conferenceDate,
      createdByUserId: pastorUser.id,
    },
  });

  await syncChurchMemberCount(prisma, DEMO_CHURCH_ID);
}

async function seedSatelliteChurch(
  prisma: PrismaClient,
  church: (typeof DEMO_CHURCHES)[number],
  passwordHash: string,
  config: {
    pastorEmail: string;
    pastorName: string;
    members: Array<{
      email: string;
      name: string;
      phone: string;
      status?: MemberStatus;
    }>;
    ministryName: string;
    ministryDescription: string;
    eventId: string;
    eventName: string;
  },
) {
  const owner = await prisma.user.findUniqueOrThrow({
    where: { email: 'owner@igreja.com.br' },
  });

  await upsertChurchMembership(prisma, {
    userId: owner.id,
    churchId: church.id,
    isOwner: true,
  });

  const pastor = await upsertDemoUser(
    prisma,
    {
      email: config.pastorEmail,
      name: config.pastorName,
      systemKey: 'pastor',
    },
    passwordHash,
  );

  await upsertChurchMembership(prisma, {
    userId: pastor.id,
    churchId: church.id,
    systemKey: 'pastor',
  });

  const ministry = await prisma.ministry.upsert({
    where: {
      churchId_name: {
        churchId: church.id,
        name: config.ministryName,
      },
    },
    update: {
      description: config.ministryDescription,
      isActive: true,
    },
    create: {
      churchId: church.id,
      name: config.ministryName,
      description: config.ministryDescription,
    },
  });

  for (const memberData of config.members) {
    await prisma.member.upsert({
      where: {
        churchId_email: {
          churchId: church.id,
          email: memberData.email,
        },
      },
      update: {
        name: memberData.name,
        phone: memberData.phone,
        status: memberData.status ?? MemberStatus.active,
      },
      create: {
        churchId: church.id,
        name: memberData.name,
        email: memberData.email,
        phone: memberData.phone,
        status: memberData.status ?? MemberStatus.active,
        membershipDate: new Date('2023-01-01'),
      },
    });
  }

  const eventDate = new Date();
  eventDate.setDate(eventDate.getDate() + 21);
  eventDate.setHours(19, 30, 0, 0);

  await prisma.ministryEvent.upsert({
    where: { id: config.eventId },
    update: {
      name: config.eventName,
      description: `Evento de demonstração da ${church.name}`,
      location: 'Templo',
      startsAt: eventDate,
      ministryId: ministry.id,
      deletedAt: null,
    },
    create: {
      id: config.eventId,
      churchId: church.id,
      ministryId: ministry.id,
      name: config.eventName,
      description: `Evento de demonstração da ${church.name}`,
      location: 'Templo',
      startsAt: eventDate,
      createdByUserId: pastor.id,
    },
  });

  await syncChurchMemberCount(prisma, church.id);
}

export async function seedDatabase(prisma = new PrismaClient()) {
  const passwordHash = await bcrypt.hash('senha123', 10);

  for (const church of DEMO_CHURCHES) {
    await ensureChurch(prisma, church);
  }

  await seedCentralChurch(prisma, passwordHash);

  await seedSatelliteChurch(prisma, DEMO_CHURCHES[1], passwordHash, {
    pastorEmail: 'pastor.norte@igreja.com.br',
    pastorName: 'Pastor do Norte',
    members: [
      {
        email: 'joao.norte@igreja.com.br',
        name: 'João Ferreira',
        phone: '11988880001',
      },
      {
        email: 'lucia.norte@igreja.com.br',
        name: 'Lúcia Almeida',
        phone: '11988880002',
      },
      {
        email: 'pedro.visitante.norte@igreja.com.br',
        name: 'Pedro Rocha',
        phone: '11988880003',
        status: MemberStatus.visitor,
      },
    ],
    ministryName: 'Louvor',
    ministryDescription: 'Equipe de louvor da unidade Norte',
    eventId: 'event_demo_norte_culto',
    eventName: 'Culto de Celebração',
  });

  await seedSatelliteChurch(prisma, DEMO_CHURCHES[2], passwordHash, {
    pastorEmail: 'pastor.sul@igreja.com.br',
    pastorName: 'Pastor do Sul',
    members: [
      {
        email: 'rafael.sul@igreja.com.br',
        name: 'Rafael Costa',
        phone: '11977770001',
      },
      {
        email: 'beatriz.sul@igreja.com.br',
        name: 'Beatriz Lima',
        phone: '11977770002',
      },
      {
        email: 'camila.sul@igreja.com.br',
        name: 'Camila Duarte',
        phone: '11977770003',
      },
    ],
    ministryName: 'Jovens',
    ministryDescription: 'Ministério de jovens e adolescentes',
    eventId: 'event_demo_sul_encontro',
    eventName: 'Encontro de Jovens',
  });
}

async function main() {
  const prisma = new PrismaClient();

  try {
    await seedDatabase(prisma);
    if (require.main === module) {
      console.log(
        'Seed concluído: 3 igrejas demo + contas *@igreja.com.br / senha123',
      );
      console.log(
        '  - Igreja Batista Central (completa)',
      );
      console.log(
        '  - Igreja Batista do Norte (pastor.norte@igreja.com.br)',
      );
      console.log(
        '  - Comunidade da Graça (pastor.sul@igreja.com.br)',
      );
      console.log(
        '  - owner@igreja.com.br tem acesso às 3 igrejas',
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
