import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ALLOW_WHEN_TRIAL_EXPIRED_KEY } from '../decorators/allow-when-trial-expired.decorator';
import { SubscriptionPolicyService } from '../services/subscription-policy.service';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Bloqueia rotas de escrita (POST/PUT/PATCH/DELETE) quando o trial expira.
 * Leitura permanece liberada. Use `@AllowWhenTrialExpired()` na whitelist.
 */
@Injectable()
export class TrialWriteGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptionPolicy: SubscriptionPolicyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      method?: string;
      params?: { churchId?: string };
    }>();

    if (!request.method || READ_METHODS.has(request.method)) {
      return true;
    }

    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_WHEN_TRIAL_EXPIRED_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (allowed) {
      return true;
    }

    const churchId = request.params?.churchId;

    if (!churchId) {
      return true;
    }

    await this.subscriptionPolicy.assertCanUseGatedFeature(churchId);

    return true;
  }
}
