import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../audit/audit.constants';
import { AuditService } from '../services/audit.service';
import { PrismaService } from '../../database/prisma.service';
import { purgeAfterFrom } from './privacy.constants';

@Injectable()
export class AccountLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async requestChurchClosure(
    churchId: string,
    userId: string,
    confirmationSlug: string,
  ) {
    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
    });

    if (!church) {
      throw new NotFoundException('Igreja não encontrada.');
    }

    if (church.deletedAt) {
      throw new ConflictException('Encerramento já solicitado.');
    }

    if (confirmationSlug.trim() !== church.slug) {
      throw new BadRequestException(
        'Confirme digitando o identificador (slug) da igreja.',
      );
    }

    const deletedAt = new Date();
    const purgeAfter = purgeAfterFrom(deletedAt);

    await this.prisma.church.update({
      where: { id: churchId },
      data: { deletedAt, purgeAfter },
    });

    await this.audit.log({
      churchId,
      actorUserId: userId,
      action: AUDIT_ACTIONS.churchClosureRequested,
      targetType: AUDIT_TARGET_TYPES.church,
      targetId: churchId,
      summary: 'Encerramento da igreja solicitado',
      metadata: { purgeAfter: purgeAfter.toISOString() },
    });

    return {
      deletedAt: deletedAt.toISOString(),
      purgeAfter: purgeAfter.toISOString(),
    };
  }

  async cancelChurchClosure(churchId: string, userId: string) {
    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
    });

    if (!church) {
      throw new NotFoundException('Igreja não encontrada.');
    }

    if (!church.deletedAt) {
      throw new BadRequestException('Nenhum encerramento pendente.');
    }

    if (church.purgeAfter && church.purgeAfter <= new Date()) {
      throw new ConflictException(
        'O prazo de retenção já passou; não é possível reativar.',
      );
    }

    await this.prisma.church.update({
      where: { id: churchId },
      data: { deletedAt: null, purgeAfter: null },
    });

    await this.audit.log({
      churchId,
      actorUserId: userId,
      action: AUDIT_ACTIONS.churchClosureCancelled,
      targetType: AUDIT_TARGET_TYPES.church,
      targetId: churchId,
      summary: 'Encerramento da igreja cancelado',
    });

    return { cancelled: true };
  }

  async deleteUserAccount(userId: string, password: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new BadRequestException('Senha incorreta.');
    }

    const ownedChurches = await this.prisma.churchMembership.findMany({
      where: {
        userId,
        isOwner: true,
        church: { deletedAt: null },
      },
      select: {
        church: { select: { id: true, name: true, slug: true } },
      },
    });

    if (ownedChurches.length > 0) {
      throw new ConflictException(
        'Transfira a propriedade ou encerre as igrejas das quais você é responsável antes de excluir a conta.',
      );
    }

    const deletedAt = new Date();

    const auditChurch = await this.prisma.churchMembership.findFirst({
      where: { userId },
      select: { churchId: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.churchMembership.deleteMany({ where: { userId } });

      await tx.member.updateMany({
        where: { userId },
        data: { userId: null },
      });

      await tx.user.update({
        where: { id: userId },
        data: { deletedAt },
      });
    });

    if (auditChurch) {
      await this.audit.log({
        churchId: auditChurch.churchId,
        actorUserId: userId,
        action: AUDIT_ACTIONS.userAccountDeleted,
        targetType: AUDIT_TARGET_TYPES.user,
        targetId: userId,
        summary: 'Conta de usuário excluída (soft-delete)',
      });
    }

    return {
      deletedAt: deletedAt.toISOString(),
      message:
        'Conta marcada para exclusão. Dados pessoais serão anonimizados após 90 dias.',
    };
  }
}
