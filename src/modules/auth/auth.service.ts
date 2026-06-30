import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';

import { ChurchPermissionsService } from '../../common/services/church-permissions.service';
import { ChurchesService } from '../churches/churches.service';
import { UsersService } from '../users/users.service';
import type {
  AuthResponse,
  IssuedTokens,
  JwtPayload,
} from './auth.types';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  private readonly revokedRefreshTokens = new Set<string>();

  constructor(
    private readonly usersService: UsersService,
    private readonly churchesService: ChurchesService,
    private readonly churchPermissionsService: ChurchPermissionsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(dto: LoginDto): Promise<{ session: AuthResponse; tokens: IssuedTokens }> {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);

    if (!passwordMatches) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    const memberships = await this.usersService.getMemberships(user.id);

    if (memberships.length === 0) {
      throw new UnauthorizedException('Usuário sem igreja vinculada.');
    }

    const primaryMembership = memberships[0];
    const session = await this.buildSession(user.id, primaryMembership.churchId);
    const tokens = this.issueTokens({
      sub: user.id,
      email: user.email,
      churchId: primaryMembership.churchId,
      role: primaryMembership.role,
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

    const role = await this.usersService.getRoleInChurch(user.id, payload.churchId);

    if (!role) {
      throw new UnauthorizedException('Sem acesso a esta igreja.');
    }

    this.revokedRefreshTokens.add(refreshToken);

    const session = await this.buildSession(user.id, payload.churchId);
    const tokens = this.issueTokens({
      sub: user.id,
      email: user.email,
      churchId: payload.churchId,
      role,
    });

    return { session, tokens };
  }

  logout(refreshToken?: string) {
    if (refreshToken) {
      this.revokedRefreshTokens.add(refreshToken);
    }
  }

  private async buildSession(userId: string, churchId: string): Promise<AuthResponse> {
    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado.');
    }

    const role = await this.usersService.getRoleInChurch(userId, churchId);

    if (!role) {
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
      role,
    );

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role,
        avatarUrl: user.avatarUrl,
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
        role: payload.role,
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
