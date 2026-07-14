import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';

import type { JwtPayload } from '../../modules/auth/auth.types';
import { SubscriptionPolicyService } from '../services/subscription-policy.service';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Writes still allowed when trial/subscription is locked.
 * Keeps member CRUD + lightweight read-acks usable without an active plan.
 */
function isAllowedWriteWhenLocked(method: string, path: string): boolean {
  // Cadastrar membro (visitante/inativo) continua liberado; o
  // MembersService bloqueia só quando o alvo vira ativo (acesso à plataforma).
  // Editar membro existente fica bloqueado (sem exceção de PATCH aqui).
  if (method === 'POST' && /\/churches\/[^/]+\/members$/.test(path)) {
    return true;
  }

  if (
    method === 'POST' &&
    /\/churches\/[^/]+\/members\/me\/ministry-notifications\/ack-catalog$/.test(
      path,
    )
  ) {
    return true;
  }

  if (
    method === 'POST' &&
    (/\/churches\/[^/]+\/announcements\/read-all$/.test(path) ||
      /\/churches\/[^/]+\/announcements\/[^/]+\/read$/.test(path))
  ) {
    return true;
  }

  if (
    method === 'POST' &&
    (/\/churches\/[^/]+\/care-requests$/.test(path) ||
      /\/churches\/[^/]+\/care-requests\/[^/]+\/view$/.test(path))
  ) {
    return true;
  }

  return false;
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
      user?: JwtPayload;
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

    // JwtAuthGuard (APP_GUARD) runs first; without user, skip DB lookup
    // (public routes or defense-in-depth — avoids church enumeration).
    if (!request.user) {
      return true;
    }

    await this.subscriptionPolicy.assertCanUseGatedFeature(churchId);

    return true;
  }
}
