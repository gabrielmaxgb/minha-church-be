import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';

import { SubscriptionPolicyService } from '../services/subscription-policy.service';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Permite cadastro de membros mesmo com trial expirado. */
function isAllowedWriteWhenLocked(method: string, path: string): boolean {
  if (method !== 'POST') {
    return false;
  }

  return /\/churches\/[^/]+\/members$/.test(path);
}

@Injectable()
export class SubscriptionWriteGuard implements CanActivate {
  constructor(
    private readonly subscriptionPolicy: SubscriptionPolicyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.subscriptionPolicy.isTrialEnforcementEnabled()) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      method?: string;
      path?: string;
      params?: { churchId?: string };
    }>();
    const method = request.method ?? 'GET';
    const path = request.path ?? '';
    const churchId = request.params?.churchId;

    if (!churchId || READ_METHODS.has(method)) {
      return true;
    }

    if (isAllowedWriteWhenLocked(method, path)) {
      return true;
    }

    if (/\/billing\/checkout$/.test(path)) {
      return true;
    }

    if (/\/billing\/portal$/.test(path)) {
      return true;
    }

    await this.subscriptionPolicy.assertCanUseGatedFeature(churchId);

    return true;
  }
}
