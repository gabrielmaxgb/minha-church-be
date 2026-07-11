import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

import { perfRequestStorage } from '../common/perf/perf-request-context';

/**
 * Usa o driver `pg` (Node) em vez do engine nativo do Prisma.
 * Em alguns ambientes o engine falha com P1001 no Neon mesmo com o banco no ar;
 * o `pg` conecta normalmente.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly pool: Pool;
  private readonly perfLogger = new Logger('PerfPrisma');

  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL não configurada.');
    }

    const pool = new Pool({
      connectionString,
      // Neon exige TLS; evita falha de handshake em alguns runtimes locais.
      ssl: connectionString.includes('sslmode=require')
        ? { rejectUnauthorized: false }
        : undefined,
      // Evita manter conexões idle eternas (Neon encerra idle; reconnects custam).
      idleTimeoutMillis: 30_000,
      max: 10,
    });

    const enableQueryLog = process.env.PERF_LOG === 'true';

    super({
      adapter: new PrismaPg(pool),
      ...(enableQueryLog
        ? {
            log: [
              { emit: 'event', level: 'query' },
              { emit: 'stdout', level: 'warn' },
              { emit: 'stdout', level: 'error' },
            ] as Prisma.LogDefinition[],
          }
        : {}),
    });
    this.pool = pool;

    if (enableQueryLog) {
      // TEMP: cada query Prisma → duração + acumulado na request atual
      this.$on('query' as never, (event: Prisma.QueryEvent) => {
        const store = perfRequestStorage.getStore();
        if (store) {
          store.prismaMs += event.duration;
          store.prismaCount += 1;
        }

        this.perfLogger.debug(
          JSON.stringify({
            durationMs: event.duration,
            target: event.target,
            query: event.query.slice(0, 180),
          }),
        );
      });
    }
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }
}
