import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ChurchPermission } from '@prisma/client';

import type { JwtPayload } from '../../modules/auth/auth.types';
import { PERMISSIONS_KEY } from '../decorators/require-permission.decorator';
import { ChurchPermissionsService } from '../services/church-permissions.service';

@Injectable()
export class ChurchAccessGuard implements CanActivate {
  constructor(private readonly churchPermissions: ChurchPermissionsService) {}

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

    const access = await this.churchPermissions.getMembershipAccess(
      user.sub,
      churchId,
    );

    if (!access) {
      throw new ForbiddenException('Sem acesso a esta igreja.');
    }

    return true;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly churchPermissions: ChurchPermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<
      ChurchPermission[]
    >(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
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

    const allowed = await this.churchPermissions.hasAnyPermission(
      user.sub,
      churchId,
      requiredPermissions,
    );

    if (!allowed) {
      throw new ForbiddenException('Permissão insuficiente.');
    }

    return true;
  }
}
