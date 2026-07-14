import { MemberStatus, PrismaClient } from '@prisma/client';

import { seedDefaultChurchRoles } from '../src/common/permissions/seed-default-church-roles';
import { createPrismaWithPg } from './pg-prisma';

async function syncChurchMemberCounts(prisma: PrismaClient) {
  const churches = await prisma.church.findMany({ select: { id: true } });

  for (const church of churches) {
    const memberCount = await prisma.member.count({
      where: {
        churchId: church.id,
        deletedAt: null,
        status: MemberStatus.active,
      },
    });

    await prisma.church.update({
      where: { id: church.id },
      data: { memberCount },
    });
  }
}

async function ensurePastoralRecordsForMembershipUsers(prisma: PrismaClient) {
  const memberships = await prisma.churchMembership.findMany({
    include: { user: true },
  });

  for (const membership of memberships) {
    const email = membership.user.email.trim().toLowerCase();

    await prisma.member.upsert({
      where: {
        churchId_userId: {
          churchId: membership.churchId,
          userId: membership.userId,
        },
      },
      update: {
        name: membership.user.name,
        email,
        status: MemberStatus.active,
        deletedAt: null,
        membershipDate: new Date(),
      },
      create: {
        churchId: membership.churchId,
        userId: membership.userId,
        name: membership.user.name,
        email,
        status: MemberStatus.active,
        membershipDate: new Date(),
      },
    });
  }

  await syncChurchMemberCounts(prisma);
}

async function refreshDefaultChurchRoles(prisma: PrismaClient) {
  const churches = await prisma.church.findMany({ select: { id: true } });

  for (const church of churches) {
    await seedDefaultChurchRoles(prisma, church.id);
  }
}

/**
 * Limpa dados operacionais (membros extras, ministérios, eventos, escalas)
 * mantendo contas de usuário, igrejas, vínculos e cargos da igreja.
 */
export async function resetDatabaseKeepUsers(prisma = new PrismaClient()) {
  const usersBefore = await prisma.user.count();
  const churchesBefore = await prisma.church.count();
  const membershipsBefore = await prisma.churchMembership.count();

  const [
    membersBefore,
    ministriesBefore,
    eventsBefore,
  ] = await Promise.all([
    prisma.member.count(),
    prisma.ministry.count(),
    prisma.ministryEvent.count(),
  ]);

  await prisma.$transaction([
    prisma.eventRosterAssignment.deleteMany(),
    prisma.eventAvailability.deleteMany(),
    prisma.memberEventRoleProfile.deleteMany(),
    prisma.eventRosterSlot.deleteMany(),
    prisma.ministryEvent.deleteMany(),
    prisma.eventRecurrenceSeries.deleteMany(),
    prisma.memberMinistryRole.deleteMany(),
    prisma.memberMinistry.deleteMany(),
    prisma.ministryRole.deleteMany(),
    prisma.ministry.deleteMany(),
    prisma.member.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.passwordResetToken.deleteMany(),
    prisma.passwordResetRequest.deleteMany(),
  ]);

  await refreshDefaultChurchRoles(prisma);
  await ensurePastoralRecordsForMembershipUsers(prisma);

  const [
    usersAfter,
    churchesAfter,
    membershipsAfter,
    membersAfter,
    ministriesAfter,
    eventsAfter,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.church.count(),
    prisma.churchMembership.count(),
    prisma.member.count({ where: { deletedAt: null } }),
    prisma.ministry.count(),
    prisma.ministryEvent.count(),
  ]);

  return {
    kept: {
      users: usersAfter,
      churches: churchesAfter,
      memberships: membershipsAfter,
    },
    removed: {
      members: membersBefore,
      ministries: ministriesBefore,
      events: eventsBefore,
    },
    after: {
      members: membersAfter,
      ministries: ministriesAfter,
      events: eventsAfter,
    },
    usersBefore,
  };
}

async function main() {
  // Usa o adapter pg (IPv4). O engine nativo do Prisma falha com P1001 no
  // endpoint Neon sa-east-1 (resolve IPv6 primeiro e a máquina não tem rota).
  const { prisma, pool } = createPrismaWithPg();

  try {
    console.log('Resetando dados operacionais (mantendo usuários e acesso à igreja)...');

    const result = await resetDatabaseKeepUsers(prisma);

    console.log('');
    console.log('Mantido:');
    console.log(`  • ${result.kept.users} usuário(s)`);
    console.log(`  • ${result.kept.churches} igreja(s)`);
    console.log(`  • ${result.kept.memberships} vínculo(s) de acesso`);
    console.log('');
    console.log('Removido:');
    console.log(`  • ${result.removed.members} registro(s) de membros (lista pastoral)`);
    console.log(`  • ${result.removed.ministries} ministério(s)`);
    console.log(`  • ${result.removed.events} evento(s)`);
    console.log('');
    console.log('Recriado:');
    console.log(`  • ${result.after.members} perfil(is) pastoral(is) mínimo(s) para quem tem acesso`);
    console.log(`  • Cargos padrão da igreja atualizados em ${result.kept.churches} igreja(s)`);
    console.log('');
    console.log('Pronto. Faça login e configure ministérios, membros e eventos do zero.');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
