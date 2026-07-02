import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { isInternalLoginEmail } from '../../common/utils/login-email';
import { normalizeCpf } from '../../common/utils/cpf';
import { PrismaService } from '../../database/prisma.service';
import type { ChurchMembershipRecord, UserRecord } from './users.types';

export interface UpdateProfileInput {
  name?: string;
  email?: string | null;
  phone?: string | null;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<UserRecord | null> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      return null;
    }

    return this.toUserRecord(user);
  }

  async findByLoginIdentifier(identifier: string): Promise<UserRecord | null> {
    const trimmed = identifier.trim();

    if (trimmed.includes('@')) {
      return this.findByEmail(trimmed);
    }

    const cpf = normalizeCpf(trimmed);

    if (cpf.length !== 11) {
      return null;
    }

    const user = await this.prisma.user.findUnique({
      where: { cpf },
    });

    if (!user) {
      return null;
    }

    return this.toUserRecord(user);
  }

  async findById(id: string): Promise<UserRecord | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return null;
    }

    return this.toUserRecord(user);
  }

  async getMemberships(userId: string): Promise<ChurchMembershipRecord[]> {
    const memberships = await this.prisma.churchMembership.findMany({
      where: { userId },
    });

    return memberships.map((membership) => ({
      userId: membership.userId,
      churchId: membership.churchId,
      isOwner: membership.isOwner,
    }));
  }

  async hasAccessToChurch(userId: string, churchId: string): Promise<boolean> {
    const membership = await this.prisma.churchMembership.findUnique({
      where: {
        userId_churchId: {
          userId,
          churchId,
        },
      },
    });

    return membership !== null;
  }

  async updatePassword(
    userId: string,
    passwordHash: string,
    mustChangePassword = false,
  ): Promise<UserRecord> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        mustChangePassword,
        temporaryPasswordEnc: null,
      },
    });

    return this.toUserRecord(user);
  }

  async getPasswordResetEmail(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberProfile: {
          select: { email: true },
        },
      },
    });

    if (!user) {
      return null;
    }

    if (!isInternalLoginEmail(user.email)) {
      return user.email;
    }

    const memberEmail = user.memberProfile?.email?.trim();

    return memberEmail || null;
  }

  async getMemberPhone(
    userId: string,
    churchId: string,
  ): Promise<string | null> {
    const member = await this.prisma.member.findFirst({
      where: { userId, churchId, deletedAt: null },
      select: { phone: true },
    });

    return member?.phone ?? null;
  }

  async updateProfile(
    userId: string,
    churchId: string,
    input: UpdateProfileInput,
  ): Promise<UserRecord> {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existing) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const userData: {
      name?: string;
      email?: string;
    } = {};

    if (input.name !== undefined) {
      userData.name = input.name.trim();
    }

    if (input.email !== undefined) {
      const normalizedEmail = input.email?.trim().toLowerCase() ?? '';
      const hasCpf = Boolean(existing.cpf);

      if (!normalizedEmail && !hasCpf) {
        throw new BadRequestException('Informe um e-mail.');
      }

      if (
        normalizedEmail &&
        normalizedEmail !== existing.email.toLowerCase()
      ) {
        const emailTaken = await this.prisma.user.findUnique({
          where: { email: normalizedEmail },
        });

        if (emailTaken && emailTaken.id !== userId) {
          throw new ConflictException('E-mail já está em uso.');
        }

        userData.email = normalizedEmail;
      }
    }

    const member = await this.prisma.member.findFirst({
      where: { userId, churchId, deletedAt: null },
    });

    const user = await this.prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: userData,
      });

      if (member) {
        const memberData: {
          name?: string;
          email?: string | null;
          phone?: string | null;
        } = {};

        if (input.name !== undefined) {
          memberData.name = input.name.trim();
        }

        if (input.email !== undefined) {
          const normalizedEmail = input.email?.trim().toLowerCase() ?? null;
          memberData.email =
            normalizedEmail ||
            (isInternalLoginEmail(updatedUser.email) ? null : updatedUser.email);
        }

        if (input.phone !== undefined) {
          memberData.phone = input.phone?.trim() || null;
        }

        if (Object.keys(memberData).length > 0) {
          await tx.member.update({
            where: { id: member.id },
            data: memberData,
          });
        }
      }

      return updatedUser;
    });

    return this.toUserRecord(user);
  }

  private toUserRecord(user: {
    id: string;
    email: string;
    cpf: string | null;
    passwordHash: string;
    name: string;
    avatarUrl: string | null;
    mustChangePassword: boolean;
  }): UserRecord {
    return {
      id: user.id,
      email: user.email,
      cpf: user.cpf ?? undefined,
      passwordHash: user.passwordHash,
      name: user.name,
      avatarUrl: user.avatarUrl ?? undefined,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
