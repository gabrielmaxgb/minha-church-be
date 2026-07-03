import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { ChurchPermissionsService } from '../../common/services/church-permissions.service';
import { EmailService } from '../../common/services/email.service';
import { PrismaService } from '../../database/prisma.service';
import { ChurchesService } from '../churches/churches.service';
import { UsersService } from '../users/users.service';
import type {
  AuthResponse,
  IssuedTokens,
  JwtPayload,
} from './auth.types';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class AuthService {
  private readonly revokedRefreshTokens = new Set<string>();

  constructor(
    private readonly usersService: UsersService,
    private readonly churchesService: ChurchesService,
    private readonly churchPermissionsService: ChurchPermissionsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async login(dto: LoginDto): Promise<{ session: AuthResponse; tokens: IssuedTokens }> {
    const user = await this.usersService.findByLoginIdentifier(dto.identifier);

    if (!user) {
      throw new UnauthorizedException('E-mail, CPF ou senha inválidos.');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);

    if (!passwordMatches) {
      throw new UnauthorizedException('E-mail, CPF ou senha inválidos.');
    }

    const memberships = await this.usersService.getMemberships(user.id);

    if (memberships.length === 0) {
      throw new UnauthorizedException('E-mail, CPF ou senha inválidos.');
    }

    const primaryMembership = memberships[0];
    const session = await this.buildSession(user.id, primaryMembership.churchId);
    const tokens = this.issueTokens({
      sub: user.id,
      email: user.email,
      churchId: primaryMembership.churchId,
    });

    return { session, tokens };
  }

  async getSession(user: JwtPayload): Promise<AuthResponse> {
    if (!(await this.usersService.hasAccessToChurch(user.sub, user.churchId))) {
      throw new UnauthorizedException('Sem acesso a esta igreja.');
    }

    return this.buildSession(user.sub, user.churchId);
  }

  async refresh(refreshToken: string): Promise<{ session: AuthResponse; tokens: IssuedTokens }> {
    if (!refreshToken || this.revokedRefreshTokens.has(refreshToken)) {
      throw new UnauthorizedException('Sessão expirada. Faça login novamente.');
    }

    let payload: JwtPayload & { type?: string };

    try {
      payload = this.jwtService.verify<JwtPayload & { type?: string }>(
        refreshToken,
      );
    } catch {
      throw new UnauthorizedException('Sessão expirada. Faça login novamente.');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Token de refresh inválido.');
    }

    const user = await this.usersService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado.');
    }

    if (!(await this.usersService.hasAccessToChurch(user.id, payload.churchId))) {
      throw new UnauthorizedException('Sem acesso a esta igreja.');
    }

    this.revokedRefreshTokens.add(refreshToken);

    const session = await this.buildSession(user.id, payload.churchId);
    const tokens = this.issueTokens({
      sub: user.id,
      email: user.email,
      churchId: payload.churchId,
    });

    return { session, tokens };
  }

  logout(refreshToken?: string) {
    if (refreshToken) {
      this.revokedRefreshTokens.add(refreshToken);
    }
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<{ session: AuthResponse; tokens: IssuedTokens }> {
    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado.');
    }

    const passwordMatches = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Senha atual incorreta.');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    await this.usersService.updatePassword(userId, passwordHash, false);

    const memberships = await this.usersService.getMemberships(userId);

    if (memberships.length === 0) {
      throw new UnauthorizedException('Usuário sem igreja vinculada.');
    }

    const churchId = memberships[0].churchId;
    const session = await this.buildSession(userId, churchId);
    const tokens = this.issueTokens({
      sub: userId,
      email: user.email,
      churchId,
    });

    return { session, tokens };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const message =
      'Se houver uma conta com esses dados, enviaremos instruções por e-mail ou sua igreja será notificada.';

    const user = await this.usersService.findByLoginIdentifier(dto.identifier);

    if (!user) {
      return { message };
    }

    const resetEmail = await this.usersService.getPasswordResetEmail(user.id);

    if (resetEmail) {
      await this.createAndSendResetToken(user.id, user.name, resetEmail);
      return { message };
    }

    await this.createAdminResetRequests(user.id);

    return { message };
  }

  async validateResetToken(token: string): Promise<{ valid: boolean }> {
    const tokenHash = this.hashResetToken(token);
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    const valid = Boolean(
      record && !record.usedAt && record.expiresAt >= new Date(),
    );

    return { valid };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const tokenHash = this.hashResetToken(dto.token);
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException(
        'Link inválido ou expirado. Solicite uma nova recuperação de senha.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    await this.usersService.updatePassword(record.userId, passwordHash, false);

    await this.prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });

    return {
      message: 'Senha redefinida com sucesso. Você já pode fazer login.',
    };
  }

  async switchChurch(
    userId: string,
    churchId: string,
  ): Promise<{ session: AuthResponse; tokens: IssuedTokens }> {
    if (!(await this.usersService.hasAccessToChurch(userId, churchId))) {
      throw new UnauthorizedException('Sem acesso a esta igreja.');
    }

    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado.');
    }

    const session = await this.buildSession(userId, churchId);
    const tokens = this.issueTokens({
      sub: userId,
      email: user.email,
      churchId,
    });

    return { session, tokens };
  }

  async updateProfile(
    userId: string,
    churchId: string,
    dto: UpdateProfileDto,
  ): Promise<{ session: AuthResponse; tokens: IssuedTokens }> {
    if (!(await this.usersService.hasAccessToChurch(userId, churchId))) {
      throw new UnauthorizedException('Sem acesso a esta igreja.');
    }

    const user = await this.usersService.updateProfile(userId, churchId, dto);
    const session = await this.buildSession(userId, churchId);
    const tokens = this.issueTokens({
      sub: userId,
      email: user.email,
      churchId,
    });

    return { session, tokens };
  }

  private async buildSession(userId: string, churchId: string): Promise<AuthResponse> {
    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado.');
    }

    const access = await this.churchPermissionsService.getMembershipAccess(
      userId,
      churchId,
    );

    if (!access) {
      throw new UnauthorizedException('Sem acesso a esta igreja.');
    }

    const memberships = await this.usersService.getMemberships(userId);
    const churches = await this.churchesService.findManyByIds(
      memberships.map((membership) => membership.churchId),
    );
    const church = await this.churchesService.findById(churchId);

    if (!church) {
      throw new UnauthorizedException('Igreja não encontrada.');
    }

    const permissions = await this.churchPermissionsService.getUserPermissions(
      userId,
      churchId,
    );
    const phone = await this.usersService.getMemberPhone(userId, churchId);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        cpf: user.cpf,
        phone,
        isOwner: access.isOwner,
        roles: access.roles.map((role) => ({
          id: role.id,
          name: role.name,
          color: role.color ?? undefined,
        })),
        avatarUrl: user.avatarUrl,
        mustChangePassword: user.mustChangePassword,
      },
      church: {
        id: church.id,
        name: church.name,
        slug: church.slug,
        memberCount: church.memberCount,
      },
      churches: churches.map((item) => ({
        id: item.id,
        name: item.name,
        slug: item.slug,
        memberCount: item.memberCount,
      })),
      permissions,
      tokens: {
        expiresIn: this.getAccessExpiresInSeconds(),
      },
    };
  }

  private issueTokens(payload: JwtPayload): IssuedTokens {
    const expiresIn = this.getAccessExpiresInSeconds();
    const accessExpiresIn = this.configService.getOrThrow<string>(
      'jwt.accessExpiresIn',
    ) as `${number}m`;
    const refreshExpiresIn = this.configService.getOrThrow<string>(
      'jwt.refreshExpiresIn',
    ) as `${number}d`;

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: accessExpiresIn,
    });
    const refreshToken = this.jwtService.sign(
      {
        sub: payload.sub,
        email: payload.email,
        churchId: payload.churchId,
        type: 'refresh',
        jti: randomUUID(),
      },
      {
        expiresIn: refreshExpiresIn,
      },
    );

    return {
      accessToken,
      refreshToken,
      expiresIn,
    };
  }

  private hashResetToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async createAndSendResetToken(
    userId: string,
    userName: string,
    email: string,
  ): Promise<void> {
    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashResetToken(token);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await this.prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });

    await this.prisma.passwordResetToken.create({
      data: { userId, tokenHash, expiresAt },
    });

    const appUrl = this.configService.getOrThrow<string>('appUrl');
    const resetUrl = `${appUrl}/redefinir-senha?token=${token}`;

    await this.emailService.sendPasswordResetEmail(email, resetUrl, userName);
  }

  private async createAdminResetRequests(userId: string): Promise<void> {
    const memberships = await this.usersService.getMemberships(userId);

    for (const membership of memberships) {
      const existing = await this.prisma.passwordResetRequest.findFirst({
        where: {
          userId,
          churchId: membership.churchId,
          status: 'pending',
        },
      });

      if (existing) {
        await this.prisma.passwordResetRequest.update({
          where: { id: existing.id },
          data: { createdAt: new Date() },
        });
        continue;
      }

      await this.prisma.passwordResetRequest.create({
        data: {
          userId,
          churchId: membership.churchId,
        },
      });
    }
  }

  private getAccessExpiresInSeconds(): number {
    const raw = this.configService.get<string>('jwt.accessExpiresIn') ?? '15m';

    if (raw.endsWith('m')) {
      return parseInt(raw, 10) * 60;
    }

    if (raw.endsWith('h')) {
      return parseInt(raw, 10) * 60 * 60;
    }

    if (raw.endsWith('d')) {
      return parseInt(raw, 10) * 60 * 60 * 24;
    }

    const seconds = parseInt(raw, 10);

    return Number.isNaN(seconds) ? 900 : seconds;
  }
}
