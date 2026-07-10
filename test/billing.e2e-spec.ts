import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { PRICING_CATALOG } from '../src/config/billing-plans.config';
import { seedDatabase } from '../prisma/seed';
import type { E2eLoginResponse } from './e2e.types';

describe('Billing (e2e)', () => {
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

  it('GET /pricing returns the public pricing catalog', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/pricing')
      .expect(200);

    expect(response.body.name).toBe(PRICING_CATALOG.name);
    expect(response.body.tiers).toHaveLength(4);
    expect(response.body.tiers[0]).toMatchObject({
      id: 'ate-100',
      monthlyPrice: 119,
    });
  });

  it('GET /churches/:id/billing/subscription returns trial summary for owner', async () => {
    const agent = request.agent(app.getHttpServer());

    const loginBody = (await agent
      .post('/api/v1/auth/login')
      .send({
        identifier: 'owner@igreja.com.br',
        password: 'senha123',
      })
      .then((res) => res.body)) as E2eLoginResponse;

    const response = await agent
      .get(`/api/v1/churches/${loginBody.church.id}/billing/subscription`)
      .set('X-Church-Id', loginBody.church.id)
      .expect(200);

    expect(response.body.subscriptionStatus).toBe('trialing');
    expect(response.body.tierId).toBe('ate-100');
    expect(response.body.memberCount).toBeGreaterThanOrEqual(0);
    expect(response.body.hasActiveSubscription).toBe(false);
  });

  it('GET /churches/:id/billing/invoices returns empty list without Stripe customer', async () => {
    const agent = request.agent(app.getHttpServer());

    const loginBody = (await agent
      .post('/api/v1/auth/login')
      .send({
        identifier: 'owner@igreja.com.br',
        password: 'senha123',
      })
      .then((res) => res.body)) as E2eLoginResponse;

    const response = await agent
      .get(`/api/v1/churches/${loginBody.church.id}/billing/invoices`)
      .set('X-Church-Id', loginBody.church.id)
      .expect(200);

    expect(response.body).toEqual([]);
  });

  it('GET /churches/:id/billing/subscription rejects non-owner', async () => {
    const agent = request.agent(app.getHttpServer());

    const loginBody = (await agent
      .post('/api/v1/auth/login')
      .send({
        identifier: 'admin@igreja.com.br',
        password: 'senha123',
      })
      .then((res) => res.body)) as E2eLoginResponse;

    await agent
      .get(`/api/v1/churches/${loginBody.church.id}/billing/subscription`)
      .set('X-Church-Id', loginBody.church.id)
      .expect(403);
  });
});
