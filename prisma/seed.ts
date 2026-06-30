import {
  PrismaClient,
  UserRole,
  MemberStatus,
  MaritalStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const DEMO_CHURCH_ID = 'church_demo';

const DEMO_USERS: Array<{
  id: string;
  email: string;
  name: string;
  role: UserRole;
}> = [
  {
    id: 'user_demo_owner',
    email: 'owner@igreja.com.br',
    name: 'Proprietário Demo',
    role: UserRole.owner,
  },
  {
    id: 'user_demo_admin',
    email: 'admin@igreja.com.br',
    name: 'Administrador Demo',
    role: UserRole.admin,
  },
  {
    id: 'user_demo_pastor',
    email: 'pastor@igreja.com.br',
    name: 'Pastor Demo',
    role: UserRole.pastor,
  },
  {
    id: 'user_demo_secretary',
    email: 'secretary@igreja.com.br',
    name: 'Secretário Demo',
    role: UserRole.secretary,
  },
  {
    id: 'user_demo_treasurer',
    email: 'treasurer@igreja.com.br',
    name: 'Tesoureiro Demo',
    role: UserRole.treasurer,
  },
  {
    id: 'user_demo_leader',
    email: 'leader@igreja.com.br',
    name: 'Líder Demo',
    role: UserRole.leader,
  },
  {
    id: 'user_demo_member',
    email: 'member@igreja.com.br',
    name: 'Membro Demo',
    role: UserRole.member,
  },
];

export async function seedDatabase(prisma = new PrismaClient()) {
  const passwordHash = await bcrypt.hash('senha123', 10);

  await prisma.church.upsert({
    where: { id: DEMO_CHURCH_ID },
    update: {
      name: 'Igreja Batista Central',
      slug: 'igreja-batista-central',
    },
    create: {
      id: DEMO_CHURCH_ID,
      name: 'Igreja Batista Central',
      slug: 'igreja-batista-central',
      memberCount: 0,
    },
  });

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
    const user = await prisma.user.upsert({
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

    await prisma.churchMembership.upsert({
      where: {
        userId_churchId: {
          userId: user.id,
          churchId: DEMO_CHURCH_ID,
        },
      },
      update: {
        role: demoUser.role,
      },
      create: {
        userId: user.id,
        churchId: DEMO_CHURCH_ID,
        role: demoUser.role,
      },
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

  await prisma.memberMinistry.upsert({
    where: {
      memberId_ministryId: {
        memberId: memberAna.id,
        ministryId: worshipMinistry.id,
      },
    },
    update: {
      ministryRoleId: worshipLeaderRole.id,
      endedAt: null,
    },
    create: {
      memberId: memberAna.id,
      ministryId: worshipMinistry.id,
      ministryRoleId: worshipLeaderRole.id,
      startedAt: new Date('2021-04-01'),
    },
  });

  await prisma.memberMinistry.upsert({
    where: {
      memberId_ministryId: {
        memberId: memberCarlos.id,
        ministryId: cellsMinistry.id,
      },
    },
    update: { endedAt: null },
    create: {
      memberId: memberCarlos.id,
      ministryId: cellsMinistry.id,
      startedAt: new Date('2019-02-01'),
    },
  });

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

  await prisma.memberMinistry.upsert({
    where: {
      memberId_ministryId: {
        memberId: leaderMember.id,
        ministryId: worshipMinistry.id,
      },
    },
    update: {
      ministryRoleId: worshipLeaderRole.id,
      endedAt: null,
    },
    create: {
      memberId: leaderMember.id,
      ministryId: worshipMinistry.id,
      ministryRoleId: worshipLeaderRole.id,
      startedAt: new Date('2022-02-01'),
    },
  });

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

  const memberCount = await prisma.member.count({
    where: {
      churchId: DEMO_CHURCH_ID,
      deletedAt: null,
      status: { in: [MemberStatus.active, MemberStatus.visitor] },
    },
  });

  await prisma.church.update({
    where: { id: DEMO_CHURCH_ID },
    data: { memberCount },
  });
}

async function main() {
  const prisma = new PrismaClient();

  try {
    await seedDatabase(prisma);
    if (require.main === module) {
      console.log(
        'Seed concluído: contas *@igreja.com.br (owner, admin, pastor, ...) / senha123',
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
