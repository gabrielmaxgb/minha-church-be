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

const CENTRAL_MOCK_MEMBERS: Array<{
  name: string;
  email: string;
  phone: string;
  status: MemberStatus;
  city?: string;
}> = [
  {
    name: 'Ana Carolina Mendes',
    email: 'ana.mendes@batistacentral.demo',
    phone: '(11) 98765-1001',
    status: MemberStatus.active,
    city: 'São Paulo',
  },
  {
    name: 'Bruno Henrique Silva',
    email: 'bruno.silva@batistacentral.demo',
    phone: '(11) 98765-1002',
    status: MemberStatus.active,
    city: 'São Paulo',
  },
  {
    name: 'Camila Fernandes',
    email: 'camila.fernandes@batistacentral.demo',
    phone: '(11) 98765-1003',
    status: MemberStatus.active,
    city: 'Guarulhos',
  },
  {
    name: 'Daniel Oliveira',
    email: 'daniel.oliveira@batistacentral.demo',
    phone: '(11) 98765-1004',
    status: MemberStatus.active,
    city: 'São Paulo',
  },
  {
    name: 'Eduarda Costa',
    email: 'eduarda.costa@batistacentral.demo',
    phone: '(11) 98765-1005',
    status: MemberStatus.visitor,
    city: 'Osasco',
  },
  {
    name: 'Felipe Rodrigues',
    email: 'felipe.rodrigues@batistacentral.demo',
    phone: '(11) 98765-1006',
    status: MemberStatus.active,
    city: 'São Paulo',
  },
  {
    name: 'Gabriela Almeida',
    email: 'gabriela.almeida@batistacentral.demo',
    phone: '(11) 98765-1007',
    status: MemberStatus.active,
    city: 'Santo André',
  },
  {
    name: 'Henrique Barbosa',
    email: 'henrique.barbosa@batistacentral.demo',
    phone: '(11) 98765-1008',
    status: MemberStatus.active,
    city: 'São Paulo',
  },
  {
    name: 'Isabela Martins',
    email: 'isabela.martins@batistacentral.demo',
    phone: '(11) 98765-1009',
    status: MemberStatus.visitor,
    city: 'São Bernardo do Campo',
  },
  {
    name: 'João Pedro Lima',
    email: 'joao.lima@batistacentral.demo',
    phone: '(11) 98765-1010',
    status: MemberStatus.active,
    city: 'São Paulo',
  },
  {
    name: 'Karina Souza',
    email: 'karina.souza@batistacentral.demo',
    phone: '(11) 98765-1011',
    status: MemberStatus.active,
    city: 'Diadema',
  },
  {
    name: 'Lucas Pereira',
    email: 'lucas.pereira@batistacentral.demo',
    phone: '(11) 98765-1012',
    status: MemberStatus.active,
    city: 'São Paulo',
  },
  {
    name: 'Mariana Ribeiro',
    email: 'mariana.ribeiro@batistacentral.demo',
    phone: '(11) 98765-1013',
    status: MemberStatus.active,
    city: 'Mauá',
  },
  {
    name: 'Nicolas Gomes',
    email: 'nicolas.gomes@batistacentral.demo',
    phone: '(11) 98765-1014',
    status: MemberStatus.visitor,
    city: 'São Paulo',
  },
  {
    name: 'Olívia Carvalho',
    email: 'olivia.carvalho@batistacentral.demo',
    phone: '(11) 98765-1015',
    status: MemberStatus.active,
    city: 'São Paulo',
  },
  {
    name: 'Paulo César Nunes',
    email: 'paulo.nunes@batistacentral.demo',
    phone: '(11) 98765-1016',
    status: MemberStatus.active,
    city: 'Barueri',
  },
  {
    name: 'Rafaela Dias',
    email: 'rafaela.dias@batistacentral.demo',
    phone: '(11) 98765-1017',
    status: MemberStatus.active,
    city: 'São Paulo',
  },
  {
    name: 'Samuel Teixeira',
    email: 'samuel.teixeira@batistacentral.demo',
    phone: '(11) 98765-1018',
    status: MemberStatus.active,
    city: 'Carapicuíba',
  },
  {
    name: 'Tatiane Freitas',
    email: 'tatiane.freitas@batistacentral.demo',
    phone: '(11) 98765-1019',
    status: MemberStatus.active,
    city: 'São Paulo',
  },
  {
    name: 'Vinícius Araújo',
    email: 'vinicius.araujo@batistacentral.demo',
    phone: '(11) 98765-1020',
    status: MemberStatus.active,
    city: 'São Paulo',
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

async function removeChurchAppAccess(
  prisma: PrismaClient,
  churchId: string,
  email: string,
) {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    return;
  }

  const membership = await prisma.churchMembership.findUnique({
    where: {
      userId_churchId: {
        userId: user.id,
        churchId,
      },
    },
  });

  if (!membership || membership.isOwner) {
    return;
  }

  await prisma.churchMembershipRole.deleteMany({
    where: { membershipId: membership.id },
  });

  await prisma.churchMembership.delete({
    where: { id: membership.id },
  });
}

async function upsertMockMemberPastoralOnly(
  prisma: PrismaClient,
  churchId: string,
  mockMember: (typeof CENTRAL_MOCK_MEMBERS)[number],
) {
  const membershipDate =
    mockMember.status === MemberStatus.active ? new Date('2023-06-15') : null;
  const visitorSince =
    mockMember.status === MemberStatus.visitor ? new Date('2025-11-01') : null;

  await removeChurchAppAccess(prisma, churchId, mockMember.email);

  await prisma.member.upsert({
    where: {
      churchId_email: {
        churchId,
        email: mockMember.email,
      },
    },
    update: {
      userId: null,
      name: mockMember.name,
      phone: mockMember.phone,
      city: mockMember.city ?? 'São Paulo',
      state: 'SP',
      status: mockMember.status,
      membershipDate,
      visitorSince,
      deletedAt: null,
    },
    create: {
      churchId,
      name: mockMember.name,
      email: mockMember.email,
      phone: mockMember.phone,
      city: mockMember.city ?? 'São Paulo',
      state: 'SP',
      status: mockMember.status,
      membershipDate,
      visitorSince,
    },
  });
}

async function upsertCentralMockMember(
  prisma: PrismaClient,
  churchId: string,
  passwordHash: string,
  mockMember: (typeof CENTRAL_MOCK_MEMBERS)[number],
) {
  if (mockMember.status === MemberStatus.active) {
    await upsertMockMemberWithLogin(prisma, churchId, passwordHash, mockMember);
    return;
  }

  await upsertMockMemberPastoralOnly(prisma, churchId, mockMember);
}

async function upsertMockMember(
  prisma: PrismaClient,
  input: {
    churchId: string;
    userId: string;
    name: string;
    email: string;
    phone: string;
    status: MemberStatus;
    city?: string;
  },
) {
  const membershipDate =
    input.status === MemberStatus.active ? new Date('2023-06-15') : null;
  const visitorSince =
    input.status === MemberStatus.visitor ? new Date('2025-11-01') : null;

  await prisma.member.upsert({
    where: {
      churchId_email: {
        churchId: input.churchId,
        email: input.email,
      },
    },
    update: {
      userId: input.userId,
      name: input.name,
      phone: input.phone,
      city: input.city ?? 'São Paulo',
      state: 'SP',
      status: input.status,
      membershipDate,
      visitorSince,
      deletedAt: null,
    },
    create: {
      churchId: input.churchId,
      userId: input.userId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      city: input.city ?? 'São Paulo',
      state: 'SP',
      status: input.status,
      membershipDate,
      visitorSince,
    },
  });
}

async function upsertMockMemberWithLogin(
  prisma: PrismaClient,
  churchId: string,
  passwordHash: string,
  mockMember: (typeof CENTRAL_MOCK_MEMBERS)[number],
) {
  const user = await prisma.user.upsert({
    where: { email: mockMember.email },
    update: {
      name: mockMember.name,
      passwordHash,
    },
    create: {
      email: mockMember.email,
      name: mockMember.name,
      passwordHash,
    },
  });

  await upsertChurchMembership(prisma, {
    userId: user.id,
    churchId,
    systemKey: 'member',
  });

  await upsertMockMember(prisma, {
    churchId,
    userId: user.id,
    ...mockMember,
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

  for (const mockMember of CENTRAL_MOCK_MEMBERS) {
    await upsertCentralMockMember(
      prisma,
      DEMO_CHURCH_ID,
      passwordHash,
      mockMember,
    );
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

  await upsertMemberProfile(prisma, {
    churchId,
    userId: owner.id,
    name: owner.name,
    email: owner.email,
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
      console.log('  - Igreja Batista Central: +20 membros mock no cadastro pastoral');
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
