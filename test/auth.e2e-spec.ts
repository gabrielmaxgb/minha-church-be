import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { AUTH_COOKIE, REFRESH_COOKIE } from '../src/common/constants/cookies';
import { seedDatabase } from '../prisma/seed';
import type { E2eLoginResponse } from './e2e.types';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    await seedDatabase();
  }, 30000);

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /auth/login sets httpOnly cookies and returns session', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        identifier: 'pastor@igreja.com.br',
        password: 'senha123',
      })
      .expect(200);

    const body = response.body as E2eLoginResponse;

    expect(body.user.email).toBe('pastor@igreja.com.br');
    expect(body.church.id).toBe('church_demo');
    expect(body.tokens.expiresIn).toBeGreaterThan(0);
    expect(body.tokens.accessToken).toBeUndefined();

    const cookies = response.headers['set-cookie'] as string[];

    expect(cookies.some((cookie) => cookie.startsWith(`${AUTH_COOKIE}=`))).toBe(
      true,
    );
    expect(
      cookies.some((cookie) => cookie.startsWith(`${REFRESH_COOKIE}=`)),
    ).toBe(true);
    expect(cookies.some((cookie) => cookie.includes('HttpOnly'))).toBe(true);
  });

  it('GET /auth/me returns session when access cookie is present', async () => {
    const agent = request.agent(app.getHttpServer());

    await agent
      .post('/api/v1/auth/login')
      .send({
        identifier: 'pastor@igreja.com.br',
        password: 'senha123',
      })
      .expect(200);

    const meResponse = await agent.get('/api/v1/auth/me').expect(200);

    const meBody = meResponse.body as E2eLoginResponse;

    expect(meBody.user.email).toBe('pastor@igreja.com.br');
    expect(meBody.church.slug).toBe('igreja-batista-central');
    expect(meBody.permissions?.members.manage).toBe(true);
    expect(meBody.permissions?.activities.createChurchWide).toBe(true);
  });

  it('POST /auth/register-church creates church, owner session and cookies', async () => {
    const ownerEmail = `onboarding-${Date.now()}@example.com`;

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register-church')
      .send({
        churchName: 'Igreja Teste Onboarding',
        ownerName: 'Pastor Teste',
        ownerEmail,
        password: 'senha-forte',
        acceptTerms: true,
      })
      .expect(200);

    const body = response.body as E2eLoginResponse & {
      user: { email: string; isOwner?: boolean };
      church: { id: string; name?: string; slug?: string };
    };

    expect(body.user.email).toBe(ownerEmail);
    expect(body.user.isOwner).toBe(true);
    expect(body.church.name).toBe('Igreja Teste Onboarding');
    expect(body.church.slug).toMatch(/^igreja-teste-onboarding/);
    expect(body.permissions?.members.manage).toBe(true);
    expect(body.permissions?.settings?.access).toBe(true);

    const cookies = response.headers["set-cookie"] as string[] | undefined;

    expect(cookies?.some((cookie) => cookie.startsWith(`${AUTH_COOKIE}=`))).toBe(
      true,
    );
  });

  it('POST /auth/register-church rejects duplicate owner email', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register-church')
      .send({
        churchName: 'Outra Igreja',
        ownerName: 'Duplicado',
        ownerEmail: 'pastor@igreja.com.br',
        password: 'senha-forte',
        acceptTerms: true,
      })
      .expect(409);
  });

  it('POST /auth/login rejects invalid credentials', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        identifier: 'pastor@igreja.com.br',
        password: 'senha-errada',
      })
      .expect(401);
  });

  it('POST /auth/logout clears cookies', async () => {
    const agent = request.agent(app.getHttpServer());

    await agent
      .post('/api/v1/auth/login')
      .send({
        identifier: 'pastor@igreja.com.br',
        password: 'senha123',
      })
      .expect(200);

    await agent.post('/api/v1/auth/logout').expect(204);
    await agent.get('/api/v1/auth/me').expect(401);
  });
});
