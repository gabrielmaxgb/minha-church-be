import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../audit/audit.constants';
import { AuditService } from '../services/audit.service';
import { PrismaService } from '../../database/prisma.service';
import {
  ANONYMIZED_NAME,
  retentionCutoff,
} from './privacy.constants';

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runScheduledPurge(): Promise<void> {
    await this.runPurge();
  }

  async runPurge(): Promise<{
    members: number;
    users: number;
    churches: number;
  }> {
    const cutoff = retentionCutoff();
    const members = await this.purgeMembers(cutoff);
    const users = await this.purgeUsers(cutoff);
    const churches = await this.purgeChurches();

    this.logger.log(
      `Retention purge: members=${members}, users=${users}, churches=${churches}`,
    );

    return { members, users, churches };
  }

  private async purgeMembers(cutoff: Date): Promise<number> {
    const candidates = await this.prisma.member.findMany({
      where: {
        deletedAt: { not: null, lt: cutoff },
        NOT: { name: ANONYMIZED_NAME },
      },
      select: { id: true, churchId: true },
      take: 200,
    });

    for (const member of candidates) {
      await this.anonymizeMember(member.id);
      await this.audit.log({
        churchId: member.churchId,
        action: AUDIT_ACTIONS.privacyPurged,
        targetType: 'member',
        targetId: member.id,
        summary: 'Membro anonimizado após retenção de 90 dias',
      });
    }

    return candidates.length;
  }

  async anonymizeMember(memberId: string): Promise<void> {
    await this.prisma.member.update({
      where: { id: memberId },
      data: {
        name: ANONYMIZED_NAME,
        email: null,
        cpf: null,
        phone: null,
        phoneSecondary: null,
        birthDate: null,
        gender: null,
        maritalStatus: null,
        weddingAnniversary: null,
        street: null,
        number: null,
        complement: null,
        neighborhood: null,
        city: null,
        state: null,
        zipCode: null,
        baptismDate: null,
        membershipDate: null,
        visitorSince: null,
        userId: null,
        parentalConsentAt: null,
        parentalConsentByUserId: null,
        parentalConsentGuardianMemberId: null,
        parentalConsentGuardianName: null,
        parentalConsentGuardianEmail: null,
        parentalConsentVersion: null,
      },
    });

    // Clear donor PII on linked donations while keeping financial rows.
    await this.prisma.givingDonation.updateMany({
      where: { donorMemberId: memberId },
      data: {
        payerName: ANONYMIZED_NAME,
        payerEmail: null,
      },
    });

    await this.prisma.givingSubscription.updateMany({
      where: { donorMemberId: memberId },
      data: {
        payerName: ANONYMIZED_NAME,
        payerEmail: null,
      },
    });
  }

  private async purgeUsers(cutoff: Date): Promise<number> {
    const candidates = await this.prisma.user.findMany({
      where: {
        deletedAt: { not: null, lt: cutoff },
        NOT: { name: ANONYMIZED_NAME },
      },
      select: { id: true },
      take: 100,
    });

    for (const user of candidates) {
      const tombstoneEmail = `deleted+${user.id}@invalid.local`;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          name: ANONYMIZED_NAME,
          email: tombstoneEmail,
          emailCanonical: tombstoneEmail,
          cpf: null,
          avatarUrl: null,
          temporaryPasswordEnc: null,
          passwordHash: '!',
        },
      });
    }

    return candidates.length;
  }

  private async purgeChurches(): Promise<number> {
    const now = new Date();
    const candidates = await this.prisma.church.findMany({
      where: {
        deletedAt: { not: null },
        purgeAfter: { lte: now },
        NOT: { name: ANONYMIZED_NAME },
      },
      select: { id: true },
      take: 20,
    });

    for (const church of candidates) {
      await this.anonymizeChurch(church.id);
      await this.audit.log({
        churchId: church.id,
        action: AUDIT_ACTIONS.privacyPurged,
        targetType: AUDIT_TARGET_TYPES.church,
        targetId: church.id,
        summary: 'Igreja anonimizada após retenção de encerramento',
      });
    }

    return candidates.length;
  }

  async anonymizeChurch(churchId: string): Promise<void> {
    const members = await this.prisma.member.findMany({
      where: { churchId },
      select: { id: true, deletedAt: true },
    });

    for (const member of members) {
      await this.anonymizeMember(member.id);
      if (!member.deletedAt) {
        await this.prisma.member.update({
          where: { id: member.id },
          data: { deletedAt: new Date() },
        });
      }
    }

    await this.prisma.prayerRequest.updateMany({
      where: { churchId, deletedAt: null },
      data: { body: '[removido]', deletedAt: new Date() },
    });

    await this.prisma.careRequest.updateMany({
      where: { churchId },
      data: { message: '[removido]' },
    });

    await this.prisma.churchFiscalProfile.deleteMany({ where: { churchId } });

    await this.prisma.church.update({
      where: { id: churchId },
      data: {
        name: ANONYMIZED_NAME,
        slug: `deleted-${churchId}`,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        stripePriceId: null,
      },
    });
  }
}
