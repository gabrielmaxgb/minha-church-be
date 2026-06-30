import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { seedDatabase } from '../prisma/seed';

describe('Church memberships (e2e)', () => {
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

  async function loginAs(email: string) {
    const agent = request.agent(app.getHttpServer());

    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: 'senha123' })
      .expect(200);

    return agent;
  }

  it('GET /churches/:churchId/memberships lists users for pastor', async () => {
    const agent = await loginAs('pastor@igreja.com.br');

    const response = await agent
      .get('/api/v1/churches/church_demo/memberships')
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThanOrEqual(7);
    expect(
      response.body.some(
        (item: { user: { email: string } }) =>
          item.user.email === 'treasurer@igreja.com.br',
      ),
    ).toBe(true);
  });

  it('pastor can change treasurer role to member and back', async () => {
    const pastorAgent = await loginAs('pastor@igreja.com.br');

    await pastorAgent
      .patch('/api/v1/churches/church_demo/memberships')
      .send({ role: 'member' })
      .expect(404);

    const treasurerMembership = (
      await pastorAgent
        .get('/api/v1/churches/church_demo/memberships')
        .expect(200)
    ).body.find(
      (item: { user: { email: string } }) =>
        item.user.email === 'treasurer@igreja.com.br',
    );

    expect(treasurerMembership).toBeDefined();

    await pastorAgent
      .patch(
        `/api/v1/churches/church_demo/memberships/${treasurerMembership.userId}`,
      )
      .send({ role: 'member' })
      .expect(200);

    await pastorAgent
      .patch(
        `/api/v1/churches/church_demo/memberships/${treasurerMembership.userId}`,
      )
      .send({ role: 'treasurer' })
      .expect(200);
  });

  it('pastor cannot change admin role', async () => {
    const pastorAgent = await loginAs('pastor@igreja.com.br');

    const adminMembership = (
      await pastorAgent
        .get('/api/v1/churches/church_demo/memberships')
        .expect(200)
    ).body.find(
      (item: { user: { email: string } }) =>
        item.user.email === 'admin@igreja.com.br',
    );

    await pastorAgent
      .patch(
        `/api/v1/churches/church_demo/memberships/${adminMembership.userId}`,
      )
      .send({ role: 'member' })
      .expect(403);
  });

  it('member cannot list memberships', async () => {
    const agent = await loginAs('member@igreja.com.br');

    await agent
      .get('/api/v1/churches/church_demo/memberships')
      .expect(403);
  });
});
