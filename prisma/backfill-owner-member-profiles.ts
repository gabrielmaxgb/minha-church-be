/**
 * Garante perfil pastoral (Member active) + cargo systemKey `member`
 * para owners e demais memberships existentes.
 *
 * Uso:
 *   npm run db:backfill:owner-members
 *
 * Requer DATABASE_URL no .env.
 */
import { MemberStatus } from '@prisma/client';

import { createPgPool, createPrismaWithPg } from './pg-prisma';

async function main() {
  const pool = createPgPool();
  const { prisma } = createPrismaWithPg(pool);

  try {
    const memberships = await prisma.churchMembership.findMany({
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        roleAssignments: {
          include: {
            role: { select: { systemKey: true } },
          },
        },
      },
      orderBy: [{ churchId: 'asc' }, { createdAt: 'asc' }],
    });

    console.log(`Encontradas ${memberships.length} membership(s).`);

    let profilesCreated = 0;
    let profilesLinked = 0;
    let rolesAdded = 0;
    let churchesSynced = 0;

    const churchIds = new Set<string>();

    for (const membership of memberships) {
      churchIds.add(membership.churchId);

      const email = membership.user.email.trim().toLowerCase();

      let member = await prisma.member.findFirst({
        where: {
          churchId: membership.churchId,
          deletedAt: null,
          OR: [{ userId: membership.userId }, { email }],
        },
      });

      if (!member) {
        member = await prisma.member.create({
          data: {
            churchId: membership.churchId,
            userId: membership.userId,
            name: membership.user.name,
            email,
            status: MemberStatus.active,
            membershipDate: new Date(),
          },
        });
        profilesCreated += 1;
        console.log(
          `  + Member criado: ${membership.user.name} (${membership.churchId})`,
        );
      } else if (
        member.userId !== membership.userId ||
        member.status !== MemberStatus.active ||
        member.deletedAt
      ) {
        await prisma.member.update({
          where: { id: member.id },
          data: {
            userId: membership.userId,
            name: membership.user.name,
            status: MemberStatus.active,
            membershipDate: member.membershipDate ?? new Date(),
            deletedAt: null,
          },
        });
        profilesLinked += 1;
      }

      const hasMemberRole = membership.roleAssignments.some(
        (assignment) => assignment.role.systemKey === 'member',
      );

      if (!hasMemberRole) {
        const memberRole = await prisma.churchRole.findFirst({
          where: {
            churchId: membership.churchId,
            systemKey: 'member',
          },
          select: { id: true },
        });

        if (memberRole) {
          await prisma.churchMembershipRole.createMany({
            data: [
              {
                membershipId: membership.id,
                roleId: memberRole.id,
              },
            ],
            skipDuplicates: true,
          });
          rolesAdded += 1;
        }
      }
    }

    for (const churchId of churchIds) {
      const count = await prisma.member.count({
        where: {
          churchId,
          deletedAt: null,
          status: MemberStatus.active,
        },
      });

      await prisma.church.update({
        where: { id: churchId },
        data: { memberCount: count },
      });
      churchesSynced += 1;
    }

    console.log(
      `Concluído: ${profilesCreated} perfil(is) criado(s), ${profilesLinked} vinculado(s), ${rolesAdded} cargo(s) member adicionado(s), ${churchesSynced} igreja(s) com memberCount atualizado.`,
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
