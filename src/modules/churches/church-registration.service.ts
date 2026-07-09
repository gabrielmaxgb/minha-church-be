import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { MemberStatus, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../../common/audit/audit.constants';
import { seedDefaultChurchRoles } from '../../common/permissions/seed-default-church-roles';
import { AuditService } from '../../common/services/audit.service';
import { OnboardingPolicyService } from '../../common/services/onboarding-policy.service';
import {
  buildUniqueChurchSlug,
  slugifyChurchName,
} from '../../common/utils/church-slug';
import { resolveEmailCanonical } from '../../common/utils/canonical-email';
import { PrismaService } from '../../database/prisma.service';

export interface RegisterChurchInput {
  churchName: string;
  ownerName: string;
  ownerEmail: string;
  password: string;
}

export interface RegisterChurchResult {
  churchId: string;
  userId: string;
  slug: string;
}

const BCRYPT_ROUNDS = 12;
const MAX_SLUG_ATTEMPTS = 50;

@Injectable()
export class ChurchRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly onboardingPolicy: OnboardingPolicyService,
  ) {}

  async register(input: RegisterChurchInput): Promise<RegisterChurchResult> {
    const churchName = input.churchName.trim();
    const ownerName = input.ownerName.trim();
    const ownerEmail = input.ownerEmail.trim().toLowerCase();
    const enforceCanonical = this.onboardingPolicy.isCanonicalEmailEnforced();
    const emailCanonical = resolveEmailCanonical(ownerEmail, enforceCanonical);
    const shouldVerifyEmail = this.onboardingPolicy.isEmailVerificationRequired();
    const emailVerifiedAt = shouldVerifyEmail ? null : new Date();

    if (enforceCanonical) {
      const existingCanonical = await this.prisma.user.findUnique({
        where: { emailCanonical },
        select: { id: true },
      });

      if (existingCanonical) {
        throw new ConflictException('Este e-mail já está em uso.');
      }
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: ownerEmail },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictException('Este e-mail já está em uso.');
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const acceptedAt = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const slug = await this.resolveUniqueSlug(tx, churchName);
      const church = await tx.church.create({
        data: {
          name: churchName,
          slug,
          memberCount: 0,
        },
      });

      await seedDefaultChurchRoles(tx, church.id);

      const user = await tx.user.create({
        data: {
          email: ownerEmail,
          emailCanonical,
          emailVerifiedAt,
          name: ownerName,
          passwordHash,
        },
      });

      const membership = await tx.churchMembership.create({
        data: {
          userId: user.id,
          churchId: church.id,
          isOwner: true,
        },
      });

      const adminRole = await tx.churchRole.findFirst({
        where: {
          churchId: church.id,
          systemKey: 'admin',
        },
        select: { id: true },
      });

      if (!adminRole) {
        throw new InternalServerErrorException(
          'Não foi possível concluir o cadastro. Tente novamente.',
        );
      }

      await tx.churchMembershipRole.create({
        data: {
          membershipId: membership.id,
          roleId: adminRole.id,
        },
      });

      await tx.member.create({
        data: {
          churchId: church.id,
          userId: user.id,
          name: ownerName,
          email: ownerEmail,
          status: MemberStatus.active,
          membershipDate: acceptedAt,
        },
      });

      await tx.church.update({
        where: { id: church.id },
        data: { memberCount: 1 },
      });

      return {
        churchId: church.id,
        userId: user.id,
        slug,
      };
    });

    await this.auditService.log({
      churchId: result.churchId,
      actorUserId: result.userId,
      action: AUDIT_ACTIONS.churchRegistered,
      targetType: AUDIT_TARGET_TYPES.church,
      targetId: result.churchId,
      summary: 'Igreja cadastrada via onboarding self-service.',
      metadata: {
        churchName,
        slug: result.slug,
      },
    });

    await this.auditService.log({
      churchId: result.churchId,
      actorUserId: result.userId,
      action: AUDIT_ACTIONS.termsAccepted,
      targetType: AUDIT_TARGET_TYPES.user,
      targetId: result.userId,
      summary: 'Termos de uso aceitos no cadastro da igreja.',
      metadata: {
        acceptedAt: acceptedAt.toISOString(),
      },
    });

    return result;
  }

  private async resolveUniqueSlug(
    tx: Prisma.TransactionClient,
    churchName: string,
  ): Promise<string> {
    const baseSlug = slugifyChurchName(churchName);

    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
      const candidate = buildUniqueChurchSlug(baseSlug, attempt);
      const existing = await tx.church.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });

      if (!existing) {
        return candidate;
      }
    }

    throw new ConflictException(
      'Não foi possível gerar um identificador único para a igreja. Tente outro nome.',
    );
  }
}
