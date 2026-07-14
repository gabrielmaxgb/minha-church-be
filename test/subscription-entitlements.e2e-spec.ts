import { lookup } from 'node:dns';
import { setDefaultResultOrder } from 'node:dns';

import { config as loadEnv } from 'dotenv';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ConnectOnboardingStatus,
  MemberStatus,
  PrismaClient,
  SubscriptionStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';

import { createPgPool, createPrismaWithPg } from '../prisma/pg-prisma';
import { AppModule } from '../src/app.module';
import type { E2eLoginResponse } from './e2e.types';

loadEnv();
// Neon sa-east-1 resolve IPv6 primeiro; nesta máquina só IPv4 alcança o host.
setDefaultResultOrder('ipv4first');

const DEMO_CHURCH_ID = 'church_demo';
const DEMO_CHURCH_SLUG = 'igreja-batista-central';
const E2E_FUND_SLUG = 'e2e-dizimo';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Matriz de entitlement (Opção B):
 * write guard, /doar público, visitante vs receber membro, login sem vínculo ativo.
 *
 * Exige TRIAL_ENFORCEMENT=true no ambiente (já no .env de desenvolvimento).
 */
describe('Subscription entitlements (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let pool: ReturnType<typeof createPgPool>;
  let original: {
    subscriptionStatus: SubscriptionStatus;
    trialEndsAt: Date | null;
    pastDueSince: Date | null;
  } | null = null;
  /** Snapshot da conta Connect da demo — restaurado no afterAll para não sujar. */
  let originalPaymentAccount: {
    stripeAccountId: string | null;
    onboardingStatus: ConnectOnboardingStatus;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
  } | null = null;
  let e2eFundExisted = false;

  const E2E_STRIPE_ACCOUNT_ID = 'acct_e2e_entitlements';

  beforeAll(async () => {
    process.env.TRIAL_ENFORCEMENT = 'true';

    // Warm-up DNS IPv4 (reduz P1001 intermitente no primeiro connect).
    const dbHost = (() => {
      try {
        return new URL(process.env.DATABASE_URL ?? '').hostname;
      } catch {
        return '';
      }
    })();
    if (dbHost) {
      await new Promise<void>((resolve) => {
        lookup(dbHost, { family: 4 }, () => resolve());
      });
    }

    pool = createPgPool();
    ({ prisma } = createPrismaWithPg(pool));

    const church = await prisma.church.findUniqueOrThrow({
      where: { id: DEMO_CHURCH_ID },
      select: {
        subscriptionStatus: true,
        trialEndsAt: true,
        pastDueSince: true,
      },
    });
    original = church;

    const existingPayment = await prisma.churchPaymentAccount.findUnique({
      where: { churchId: DEMO_CHURCH_ID },
      select: {
        stripeAccountId: true,
        onboardingStatus: true,
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
      },
    });
    // Conta fake de e2e anterior não conta como estado real a restaurar.
    originalPaymentAccount =
      existingPayment?.stripeAccountId === E2E_STRIPE_ACCOUNT_ID
        ? null
        : existingPayment;

    const existingFund = await prisma.givingFund.findUnique({
      where: {
        churchId_slug: {
          churchId: DEMO_CHURCH_ID,
          slug: E2E_FUND_SLUG,
        },
      },
      select: { id: true, name: true },
    });
    // Fundo e2e deixado por run anterior deve ser removido no afterAll.
    e2eFundExisted = Boolean(
      existingFund && existingFund.name !== 'Dízimo E2E',
    );

    await prisma.churchPaymentAccount.upsert({
      where: { churchId: DEMO_CHURCH_ID },
      create: {
        churchId: DEMO_CHURCH_ID,
        stripeAccountId: E2E_STRIPE_ACCOUNT_ID,
        onboardingStatus: 'active',
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
      },
      update: {
        stripeAccountId: E2E_STRIPE_ACCOUNT_ID,
        onboardingStatus: 'active',
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
      },
    });

    await prisma.givingFund.upsert({
      where: {
        churchId_slug: {
          churchId: DEMO_CHURCH_ID,
          slug: E2E_FUND_SLUG,
        },
      },
      create: {
        churchId: DEMO_CHURCH_ID,
        name: 'Dízimo E2E',
        slug: E2E_FUND_SLUG,
        isActive: true,
      },
      update: {
        isActive: true,
        name: 'Dízimo E2E',
      },
    });
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
    if (original) {
      await prisma.church.update({
        where: { id: DEMO_CHURCH_ID },
        data: {
          subscriptionStatus: original.subscriptionStatus,
          trialEndsAt: original.trialEndsAt,
          pastDueSince: original.pastDueSince,
        },
      });
    }
    await app.close();
  });

  afterAll(async () => {
    if (original) {
      await prisma.church.update({
        where: { id: DEMO_CHURCH_ID },
        data: {
          subscriptionStatus: original.subscriptionStatus,
          trialEndsAt: original.trialEndsAt,
          pastDueSince: original.pastDueSince,
        },
      });
    }

    // Não deixar a demo com conta Stripe fake do e2e.
    if (originalPaymentAccount) {
      await prisma.churchPaymentAccount.update({
        where: { churchId: DEMO_CHURCH_ID },
        data: {
          stripeAccountId: originalPaymentAccount.stripeAccountId,
          onboardingStatus: originalPaymentAccount.onboardingStatus,
          chargesEnabled: originalPaymentAccount.chargesEnabled,
          payoutsEnabled: originalPaymentAccount.payoutsEnabled,
          detailsSubmitted: originalPaymentAccount.detailsSubmitted,
        },
      });
    } else {
      await prisma.churchPaymentAccount.deleteMany({
        where: {
          churchId: DEMO_CHURCH_ID,
          stripeAccountId: E2E_STRIPE_ACCOUNT_ID,
        },
      });
    }

    if (!e2eFundExisted) {
      const fund = await prisma.givingFund.findUnique({
        where: {
          churchId_slug: {
            churchId: DEMO_CHURCH_ID,
            slug: E2E_FUND_SLUG,
          },
        },
        select: { id: true },
      });
      if (fund) {
        await prisma.givingDonation.deleteMany({ where: { fundId: fund.id } });
        await prisma.givingFund.delete({ where: { id: fund.id } });
      }
    }

    await prisma.$disconnect();
    await pool.end();
  });

  async function setSubscription(state: {
    subscriptionStatus: SubscriptionStatus;
    trialEndsAt?: Date | null;
    pastDueSince?: Date | null;
  }): Promise<void> {
    await prisma.church.update({
      where: { id: DEMO_CHURCH_ID },
      data: {
        subscriptionStatus: state.subscriptionStatus,
        trialEndsAt: state.trialEndsAt ?? null,
        pastDueSince: state.pastDueSince ?? null,
      },
    });
  }

  async function loginOwner(): Promise<{
    agent: ReturnType<typeof request.agent>;
    body: E2eLoginResponse;
  }> {
    const agent = request.agent(app.getHttpServer());
    const response = await agent.post('/api/v1/auth/login').send({
      identifier: 'owner@igreja.com.br',
      password: 'senha123',
    });

    expect(response.status).toBe(200);
    return { agent, body: response.body as E2eLoginResponse };
  }

  describe('login session lockReason', () => {
    it('active: featuresUnlocked and no lockReason', async () => {
      await setSubscription({
        subscriptionStatus: SubscriptionStatus.active,
        trialEndsAt: null,
        pastDueSince: null,
      });

      const { body } = await loginOwner();
      expect(body.church.featuresLocked).toBe(false);
      expect(body.church.lockReason ?? null).toBeNull();
    });

    it('trialing expired: locked with trial_expired', async () => {
      await setSubscription({
        subscriptionStatus: SubscriptionStatus.trialing,
        trialEndsAt: new Date(Date.now() - DAY_MS),
        pastDueSince: null,
      });

      const { body } = await loginOwner();
      expect(body.church.featuresLocked).toBe(true);
      expect(body.church.lockReason).toBe('trial_expired');
    });

    it('past_due: locked with past_due', async () => {
      await setSubscription({
        subscriptionStatus: SubscriptionStatus.past_due,
        pastDueSince: new Date(Date.now() - 2 * DAY_MS),
      });

      const { body } = await loginOwner();
      expect(body.church.featuresLocked).toBe(true);
      expect(body.church.lockReason).toBe('past_due');
    });

    it('canceled: locked with canceled', async () => {
      await setSubscription({
        subscriptionStatus: SubscriptionStatus.canceled,
      });

      const { body } = await loginOwner();
      expect(body.church.featuresLocked).toBe(true);
      expect(body.church.lockReason).toBe('canceled');
    });
  });

  describe('write guard + members when locked', () => {
    beforeEach(async () => {
      await setSubscription({
        subscriptionStatus: SubscriptionStatus.canceled,
      });
    });

    it('blocks premium writes (create ministry)', async () => {
      const { agent, body } = await loginOwner();

      const response = await agent
        .post(`/api/v1/churches/${body.church.id}/ministries`)
        .set('X-Church-Id', body.church.id)
        .send({ name: 'Ministério E2E Block' });

      expect(response.status).toBe(403);
      expect(String(response.body.message)).toMatch(/assinatura|plano|encerrada/i);
    });

    it('blocks PATCH members when locked', async () => {
      const { agent, body } = await loginOwner();

      const visitor = await agent
        .post(`/api/v1/churches/${body.church.id}/members`)
        .set('X-Church-Id', body.church.id)
        .send({
          name: 'Visitante Patch Block',
          status: MemberStatus.visitor,
        })
        .expect(201);

      const patch = await agent
        .patch(
          `/api/v1/churches/${body.church.id}/members/${visitor.body.id}`,
        )
        .set('X-Church-Id', body.church.id)
        .send({ phone: '11999990000' });

      expect(patch.status).toBe(403);
    });

    it('allows creating a visitor when locked', async () => {
      const { agent, body } = await loginOwner();

      const response = await agent
        .post(`/api/v1/churches/${body.church.id}/members`)
        .set('X-Church-Id', body.church.id)
        .send({
          name: 'Visitante Liberado E2E',
          status: MemberStatus.visitor,
        });

      expect(response.status).toBe(201);
      expect(response.body.status).toBe('visitor');
    });

    it('blocks creating an active member when locked', async () => {
      const { agent, body } = await loginOwner();
      const suffix = Date.now();

      const response = await agent
        .post(`/api/v1/churches/${body.church.id}/members`)
        .set('X-Church-Id', body.church.id)
        .send({
          name: 'Ativo Bloqueado E2E',
          email: `ativo.bloqueado.${suffix}@example.com`,
          status: MemberStatus.active,
        });

      expect(response.status).toBe(403);
    });

    it('blocks receive-as-member when locked', async () => {
      const { agent, body } = await loginOwner();
      const suffix = Date.now();

      const visitor = await agent
        .post(`/api/v1/churches/${body.church.id}/members`)
        .set('X-Church-Id', body.church.id)
        .send({
          name: 'Visitante Receber Block',
          email: `receber.block.${suffix}@example.com`,
          status: MemberStatus.visitor,
        })
        .expect(201);

      const receive = await agent
        .post(
          `/api/v1/churches/${body.church.id}/members/${visitor.body.id}/receive`,
        )
        .set('X-Church-Id', body.church.id);

      expect(receive.status).toBe(403);
    });

    it('blocks payments panel writes (create fund) when locked', async () => {
      const { agent, body } = await loginOwner();

      const response = await agent
        .post(`/api/v1/churches/${body.church.id}/payments/funds`)
        .set('X-Church-Id', body.church.id)
        .send({ name: 'Fundo Bloqueado E2E' });

      expect(response.status).toBe(403);
    });
  });

  describe('public giving /doar entitlement', () => {
    const publicPath = `/api/v1/public/giving/${DEMO_CHURCH_SLUG}/${E2E_FUND_SLUG}`;

    it('active: public fund details available', async () => {
      await setSubscription({
        subscriptionStatus: SubscriptionStatus.active,
      });

      await request(app.getHttpServer()).get(publicPath).expect(200);
    });

    it('trialing valid: public fund details available', async () => {
      await setSubscription({
        subscriptionStatus: SubscriptionStatus.trialing,
        trialEndsAt: new Date(Date.now() + 5 * DAY_MS),
      });

      await request(app.getHttpServer()).get(publicPath).expect(200);
    });

    it('trialing expired: public giving forbidden', async () => {
      await setSubscription({
        subscriptionStatus: SubscriptionStatus.trialing,
        trialEndsAt: new Date(Date.now() - DAY_MS),
      });

      const response = await request(app.getHttpServer())
        .get(publicPath)
        .expect(403);

      expect(String(response.body.message)).toMatch(/indisponíveis/i);
    });

    it('past_due within grace: public giving stays up', async () => {
      await setSubscription({
        subscriptionStatus: SubscriptionStatus.past_due,
        pastDueSince: new Date(Date.now() - 2 * DAY_MS),
      });

      await request(app.getHttpServer()).get(publicPath).expect(200);
    });

    it('past_due past grace: public giving forbidden', async () => {
      await setSubscription({
        subscriptionStatus: SubscriptionStatus.past_due,
        pastDueSince: new Date(Date.now() - 30 * DAY_MS),
      });

      await request(app.getHttpServer()).get(publicPath).expect(403);
    });

    it('canceled: public giving forbidden even with recent pastDueSince', async () => {
      await setSubscription({
        subscriptionStatus: SubscriptionStatus.canceled,
        pastDueSince: new Date(Date.now() - DAY_MS),
      });

      await request(app.getHttpServer()).get(publicPath).expect(403);
    });

    it('checkout also respects entitlement (canceled → 403)', async () => {
      await setSubscription({
        subscriptionStatus: SubscriptionStatus.canceled,
      });

      const response = await request(app.getHttpServer())
        .post(`${publicPath}/checkout`)
        .send({
          amountCents: 5000,
          payerName: 'Doador E2E',
          payerEmail: 'doador.e2e@example.com',
        });

      expect(response.status).toBe(403);
    });
  });

  describe('login without active membership', () => {
    const orphanEmail = 'e2e.orphan.no.membership@example.com';

    beforeAll(async () => {
      const passwordHash = await bcrypt.hash('senha123', 10);
      await prisma.user.upsert({
        where: { email: orphanEmail },
        create: {
          email: orphanEmail,
          emailCanonical: orphanEmail,
          name: 'Órfão E2E',
          passwordHash,
          emailVerifiedAt: new Date(),
        },
        update: {
          passwordHash,
          emailVerifiedAt: new Date(),
        },
      });

      const user = await prisma.user.findUniqueOrThrow({
        where: { email: orphanEmail },
        select: { id: true },
      });

      await prisma.churchMembership.deleteMany({
        where: { userId: user.id },
      });
    });

    afterAll(async () => {
      const user = await prisma.user.findUnique({
        where: { email: orphanEmail },
        select: { id: true },
      });
      if (user) {
        await prisma.churchMembership.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
      }
    });

    it('returns friendly copy when password is correct but no active access', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          identifier: orphanEmail,
          password: 'senha123',
        })
        .expect(401);

      expect(String(response.body.message)).toMatch(/acesso ainda não está ativo/i);
    });

    it('still returns generic invalid-credentials for wrong password', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          identifier: orphanEmail,
          password: 'senha-errada',
        })
        .expect(401);

      expect(String(response.body.message)).toMatch(/e-mail|cpf|senha inválidos/i);
    });
  });

  describe('trialing valid keeps premium writes open', () => {
    it('allows create ministry and does not subscription-block payments writes', async () => {
      await setSubscription({
        subscriptionStatus: SubscriptionStatus.trialing,
        trialEndsAt: new Date(Date.now() + 10 * DAY_MS),
      });

      const { agent, body } = await loginOwner();
      expect(body.church.featuresLocked).toBe(false);

      const ministry = await agent
        .post(`/api/v1/churches/${body.church.id}/ministries`)
        .set('X-Church-Id', body.church.id)
        .send({ name: `Ministério Trial E2E ${Date.now()}` });

      expect(ministry.status).toBe(201);

      // Sem perfil fiscal completo o service pode responder 400 — o que importa
      // aqui é que o SubscriptionWriteGuard NÃO barrizou (≠ 403).
      const fund = await agent
        .post(`/api/v1/churches/${body.church.id}/payments/funds`)
        .set('X-Church-Id', body.church.id)
        .send({ name: `Fundo Trial E2E ${Date.now()}` });

      expect(fund.status).not.toBe(403);
      expect([201, 400]).toContain(fund.status);
    });
  });
});
