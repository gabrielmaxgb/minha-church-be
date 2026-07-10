import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import type { JwtPayload } from '../../modules/auth/auth.types';
import { ChurchPermissionsService } from '../services/church-permissions.service';

@Injectable()
export class ChurchOwnerGuard implements CanActivate {
  constructor(
    private readonly churchPermissions: ChurchPermissionsService,
  ) {}

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

    if (!access?.isOwner) {
      throw new ForbiddenException(
        'Somente o proprietário da igreja pode gerenciar a assinatura.',
      );
    }

    return true;
  }
}
