import { Injectable } from '@nestjs/common';
import type { UserRole } from '../../common/types/user-role';

import { PrismaService } from '../../database/prisma.service';
import type { ChurchMembershipRecord, UserRecord } from './users.types';

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
      role: membership.role as UserRole,
    }));
  }

  async getRoleInChurch(
    userId: string,
    churchId: string,
  ): Promise<UserRole | null> {
    const membership = await this.prisma.churchMembership.findUnique({
      where: {
        userId_churchId: {
          userId,
          churchId,
        },
      },
    });

    return membership?.role ?? null;
  }

  async hasAccessToChurch(userId: string, churchId: string): Promise<boolean> {
    const role = await this.getRoleInChurch(userId, churchId);

    return role !== null;
  }

  private toUserRecord(user: {
    id: string;
    email: string;
    passwordHash: string;
    name: string;
    avatarUrl: string | null;
  }): UserRecord {
    return {
      id: user.id,
      email: user.email,
      passwordHash: user.passwordHash,
      name: user.name,
      avatarUrl: user.avatarUrl ?? undefined,
    };
  }
}
