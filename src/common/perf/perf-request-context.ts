import { AsyncLocalStorage } from 'node:async_hooks';

export type MembershipCacheEntry =
  | {
      status: 'pending';
      // Promise tipada no ChurchPermissionsService ao gravar/ler.
      promise: Promise<unknown>;
    }
  | {
      status: 'resolved';
      value: unknown;
    };

export type RequestContextStore = {
  prismaMs: number;
  prismaCount: number;
  path: string;
  method: string;
  /** Cache de MembershipAccess por `${userId}:${churchId}` nesta request. */
  membershipCache: Map<string, MembershipCacheEntry>;
};

/**
 * Contexto por request HTTP (AsyncLocalStorage).
 * Sempre ativo: cache de membership.
 * PERF_LOG=true: também acumula prismaMs/prismaCount.
 */
export const requestContextStorage =
  new AsyncLocalStorage<RequestContextStore>();

/** Alias usado pelo PrismaService / middleware de perf. */
export const perfRequestStorage = requestContextStorage;

export type PerfRequestStore = RequestContextStore;

export function membershipCacheKey(userId: string, churchId: string): string {
  return `${userId}:${churchId}`;
}

export function invalidateMembershipAccessCache(
  userId: string,
  churchId: string,
): void {
  const store = requestContextStorage.getStore();
  if (!store) {
    return;
  }

  store.membershipCache.delete(membershipCacheKey(userId, churchId));
}
