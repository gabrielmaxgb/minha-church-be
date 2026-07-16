import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';

import { requestContextMiddleware } from './common/perf/perf-timing.middleware';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const configService = app.get(ConfigService);

  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  // Cache MembershipAccess por request; PERF_LOG=true → timing JSON
  app.use(requestContextMiddleware);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // Suporta uma origem ou lista separada por vírgula
  // (ex.: https://minhachurch.com,https://www.minhachurch.com).
  const corsOriginRaw = configService.get<string>('corsOrigin') ?? '';
  const corsOrigins = corsOriginRaw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins.length <= 1 ? corsOrigins[0] : corsOrigins,
    credentials: true,
  });

  const port = configService.get<number>('port') ?? 3001;

  await app.listen(port);
}

void bootstrap();
