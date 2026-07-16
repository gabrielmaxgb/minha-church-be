import { Injectable } from '@nestjs/common';
import { LegalDocumentType } from '@prisma/client';

import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../audit/audit.constants';
import { AuditService } from '../services/audit.service';
import { PrismaService } from '../../database/prisma.service';
import {
  DPA_VERSION,
  LEGAL_DOC_VERSION,
} from './privacy.constants';

export interface RecordAcceptancesInput {
  churchId: string;
  userId: string;
  ip?: string | null;
  includeDpa?: boolean;
}

@Injectable()
export class LegalAcceptanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async recordRegistrationAcceptances(
    input: RecordAcceptancesInput,
  ): Promise<void> {
    const acceptedAt = new Date();
    const rows: {
      churchId: string;
      userId: string;
      documentType: LegalDocumentType;
      version: string;
      acceptedAt: Date;
      ip?: string | null;
    }[] = [
      {
        churchId: input.churchId,
        userId: input.userId,
        documentType: LegalDocumentType.terms,
        version: LEGAL_DOC_VERSION,
        acceptedAt,
        ip: input.ip,
      },
      {
        churchId: input.churchId,
        userId: input.userId,
        documentType: LegalDocumentType.privacy,
        version: LEGAL_DOC_VERSION,
        acceptedAt,
        ip: input.ip,
      },
    ];

    if (input.includeDpa !== false) {
      rows.push({
        churchId: input.churchId,
        userId: input.userId,
        documentType: LegalDocumentType.dpa,
        version: DPA_VERSION,
        acceptedAt,
        ip: input.ip,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.legalAcceptance.createMany({ data: rows });

      if (input.includeDpa !== false) {
        await tx.church.update({
          where: { id: input.churchId },
          data: {
            dpaAcceptedAt: acceptedAt,
            dpaVersion: DPA_VERSION,
          },
        });
      }
    });

    await this.audit.log({
      churchId: input.churchId,
      actorUserId: input.userId,
      action: AUDIT_ACTIONS.termsAccepted,
      targetType: AUDIT_TARGET_TYPES.church,
      targetId: input.churchId,
      summary: 'Termos e privacidade aceitos no cadastro',
      metadata: { version: LEGAL_DOC_VERSION },
    });

    if (input.includeDpa !== false) {
      await this.audit.log({
        churchId: input.churchId,
        actorUserId: input.userId,
        action: AUDIT_ACTIONS.dpaAccepted,
        targetType: AUDIT_TARGET_TYPES.church,
        targetId: input.churchId,
        summary: 'Adendo LGPD (DPA) aceito',
        metadata: { version: DPA_VERSION },
      });
    }
  }

  async acceptDpa(churchId: string, userId: string, ip?: string | null) {
    const acceptedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.legalAcceptance.create({
        data: {
          churchId,
          userId,
          documentType: LegalDocumentType.dpa,
          version: DPA_VERSION,
          acceptedAt,
          ip: ip ?? null,
        },
      });

      await tx.church.update({
        where: { id: churchId },
        data: {
          dpaAcceptedAt: acceptedAt,
          dpaVersion: DPA_VERSION,
        },
      });
    });

    await this.audit.log({
      churchId,
      actorUserId: userId,
      action: AUDIT_ACTIONS.dpaAccepted,
      targetType: AUDIT_TARGET_TYPES.church,
      targetId: churchId,
      summary: 'Adendo LGPD (DPA) aceito',
      metadata: { version: DPA_VERSION },
    });

    return {
      dpaAcceptedAt: acceptedAt.toISOString(),
      dpaVersion: DPA_VERSION,
    };
  }

  isDpaCurrent(dpaAcceptedAt: Date | null, dpaVersion: string | null): boolean {
    return Boolean(dpaAcceptedAt) && dpaVersion === DPA_VERSION;
  }
}
