import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { JwtPayload } from '../../modules/auth/auth.types';
import { UsersService } from '../../modules/users/users.service';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { UserRole } from '../types/user-role';

@Injectable()
export class ChurchAccessGuard implements CanActivate {
  constructor(private readonly usersService: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user?: JwtPayload;
      params?: { churchId?: string };
    }>();
    const user = request.user;
    const churchId = request.params?.churchId;

    if (!user || !churchId) {
      throw new ForbiddenException('Acesso negado.');
    }

    const hasAccess = await this.usersService.hasAccessToChurch(user.sub, churchId);

    if (!hasAccess) {
      throw new ForbiddenException('Sem acesso a esta igreja.');
    }

    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: JwtPayload;
      params?: { churchId?: string };
    }>();
    const user = request.user;
    const churchId = request.params?.churchId;

    if (!user || !churchId) {
      throw new ForbiddenException('Acesso negado.');
    }

    const role = await this.usersService.getRoleInChurch(user.sub, churchId);

    if (!role || !requiredRoles.includes(role)) {
      throw new ForbiddenException('Permissão insuficiente.');
    }

    return true;
  }
}
