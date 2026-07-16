import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { seedDatabase } from '../prisma/seed';
import type { E2eLoginResponse } from './e2e.types';

describe('Payments / Connect (e2e)', () => {
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

  async function login(identifier: string): Promise<{
    agent: ReturnType<typeof request.agent>;
    body: E2eLoginResponse;
  }> {
    const agent = request.agent(app.getHttpServer());
    const body = (await agent
      .post('/api/v1/auth/login')
      .send({ identifier, password: 'senha123' })
      .then((res) => res.body)) as E2eLoginResponse;

    return { agent, body };
  }

  it('GET connect/status returns default "none" state for owner', async () => {
    const { agent, body } = await login('owner@igreja.com.br');

    const response = await agent
      .get(`/api/v1/churches/${body.church.id}/payments/connect/status`)
      .set('X-Church-Id', body.church.id)
      .expect(200);

    expect(response.body.hasAccount).toBe(false);
    expect(response.body.canReceivePayments).toBe(false);
    expect(response.body.onboardingStatus).toBe('none');
    expect(response.body.capabilities).toMatchObject({
      pix: 'inactive',
      card: 'inactive',
      boleto: 'inactive',
    });
  });

  it('GET connect/status is allowed for finances_access (treasurer)', async () => {
    const { agent, body } = await login('treasurer@igreja.com.br');

    await agent
      .get(`/api/v1/churches/${body.church.id}/payments/connect/status`)
      .set('X-Church-Id', body.church.id)
      .expect(200);
  });

  it('GET connect/status rejects users without finances_access', async () => {
    const { agent, body } = await login('member@igreja.com.br');

    await agent
      .get(`/api/v1/churches/${body.church.id}/payments/connect/status`)
      .set('X-Church-Id', body.church.id)
      .expect(403);
  });

  it('POST connect/account rejects owner without complete fiscal profile', async () => {
    const { agent, body } = await login('owner@igreja.com.br');

    const response = await agent
      .post(`/api/v1/churches/${body.church.id}/payments/connect/account`)
      .set('X-Church-Id', body.church.id)
      .send({})
      .expect(400);

    expect(String(response.body.message)).toMatch(/identificação fiscal/i);
  });

  it('PUT fiscal-profile persists and normalizes a valid CNPJ for owner', async () => {
    const { agent, body } = await login('owner@igreja.com.br');

    const putResponse = await agent
      .put(`/api/v1/churches/${body.church.id}/payments/fiscal-profile`)
      .set('X-Church-Id', body.church.id)
      .send({
        documentType: 'cnpj',
        documentNumber: '11.222.333/0001-81',
        legalName: 'Igreja Batista Central',
        responsibleName: 'Proprietário Demo',
        responsibleDocument: '390.533.447-05',
      })
      .expect(200);

    expect(putResponse.body).toMatchObject({
      documentType: 'cnpj',
      documentNumber: '11222333000181',
      legalName: 'Igreja Batista Central',
      responsibleName: 'Proprietário Demo',
    });

    const getResponse = await agent
      .get(`/api/v1/churches/${body.church.id}/payments/fiscal-profile`)
      .set('X-Church-Id', body.church.id)
      .expect(200);

    expect(getResponse.body.documentNumber).toBe('11222333000181');
  });

  it('PUT fiscal-profile rejects an invalid CNPJ', async () => {
    const { agent, body } = await login('owner@igreja.com.br');

    await agent
      .put(`/api/v1/churches/${body.church.id}/payments/fiscal-profile`)
      .set('X-Church-Id', body.church.id)
      .send({
        documentType: 'cnpj',
        documentNumber: '11.111.111/1111-11',
        legalName: 'Igreja Teste',
        responsibleName: 'Responsável',
        responsibleDocument: '390.533.447-05',
      })
      .expect(400);
  });

  it('PUT fiscal-profile rejects non-owner', async () => {
    const { agent, body } = await login('admin@igreja.com.br');

    await agent
      .put(`/api/v1/churches/${body.church.id}/payments/fiscal-profile`)
      .set('X-Church-Id', body.church.id)
      .send({
        documentType: 'cpf',
        documentNumber: '390.533.447-05',
        legalName: 'Igreja Teste',
        responsibleName: 'Responsável',
      })
      .expect(403);
  });

  it('POST connect/account rejects non-owner (treasurer) before touching Stripe', async () => {
    const { agent, body } = await login('treasurer@igreja.com.br');

    await agent
      .post(`/api/v1/churches/${body.church.id}/payments/connect/account`)
      .set('X-Church-Id', body.church.id)
      .send({})
      .expect(403);
  });

  it('POST connect/webhook rejects a request without a signature', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/payments/connect/webhook')
      .send({ id: 'evt_test', type: 'account.updated' })
      .expect(400);
  });

  it('POST donations/:id/refund returns 404 for unknown donation', async () => {
    const { agent, body } = await login('treasurer@igreja.com.br');

    await agent
      .post(
        `/api/v1/churches/${body.church.id}/payments/donations/nonexistent/refund`,
      )
      .set('X-Church-Id', body.church.id)
      .send({})
      .expect(404);
  });

  it('GET donations returns paginated list for treasurer', async () => {
    const { agent, body } = await login('treasurer@igreja.com.br');

    const response = await agent
      .get(`/api/v1/churches/${body.church.id}/payments/donations`)
      .set('X-Church-Id', body.church.id)
      .expect(200);

    expect(response.body).toMatchObject({
      page: 1,
      limit: 50,
      total: expect.any(Number),
      items: expect.any(Array),
    });
  });

  it('GET donations/export returns CSV for treasurer', async () => {
    const { agent, body } = await login('treasurer@igreja.com.br');

    const response = await agent
      .get(`/api/v1/churches/${body.church.id}/payments/donations/export`)
      .set('X-Church-Id', body.church.id)
      .expect(200);

    expect(String(response.headers['content-type'])).toMatch(/text\/csv/i);
    expect(String(response.text)).toMatch(/Data,Fundo,Valor/i);
  });
});
