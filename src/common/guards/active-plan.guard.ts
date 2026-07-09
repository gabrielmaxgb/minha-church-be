import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import type { JwtPayload } from '../../modules/auth/auth.types';
import { SubscriptionPolicyService } from '../services/subscription-policy.service';

/**
 * Bloqueia recursos de gestão/crescimento (criar ministérios, atividades e
 * escalas) quando o período de teste da igreja expira. Aplicar após
 * `ChurchAccessGuard` para garantir que o usuário pertence à igreja.
 */
@Injectable()
export class ActivePlanGuard implements CanActivate {
  constructor(
    private readonly subscriptionPolicy: SubscriptionPolicyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user?: JwtPayload;
      params?: { churchId?: string };
    }>();
    const churchId = request.params?.churchId;

    if (!churchId) {
      throw new ForbiddenException('Acesso negado.');
    }

    await this.subscriptionPolicy.assertCanUseGatedFeature(churchId);

    return true;
  }
}
