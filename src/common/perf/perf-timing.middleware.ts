import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { requestContextStorage } from './perf-request-context';

const logger = new Logger('PerfTiming');

/**
 * Sempre cria AsyncLocalStorage da request (cache de MembershipAccess).
 * Com PERF_LOG=true, também loga totalMs / prismaMs / prismaCount no finish.
 */
export function requestContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const store = {
    prismaMs: 0,
    prismaCount: 0,
    path: req.originalUrl ?? req.url,
    method: req.method,
    membershipCache: new Map(),
  };
  const started = Date.now();
  const perfEnabled = process.env.PERF_LOG === 'true';

  requestContextStorage.run(store, () => {
    if (perfEnabled) {
      res.on('finish', () => {
        const totalMs = Date.now() - started;
        logger.log(
          JSON.stringify({
            method: store.method,
            path: store.path,
            statusCode: res.statusCode,
            totalMs,
            prismaMs: store.prismaMs,
            nonPrismaMs: Math.max(0, totalMs - store.prismaMs),
            prismaCount: store.prismaCount,
            membershipCacheSize: store.membershipCache.size,
          }),
        );
      });
    }

    next();
  });
}

/** @deprecated nome antigo — use requestContextMiddleware */
export const perfTimingMiddleware = requestContextMiddleware;
