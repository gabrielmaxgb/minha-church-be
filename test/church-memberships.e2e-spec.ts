import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { seedDatabase } from '../prisma/seed';
import type { E2eMembershipItem } from './e2e.types';

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

    const memberships = response.body as E2eMembershipItem[];

    expect(Array.isArray(memberships)).toBe(true);
    expect(memberships.length).toBeGreaterThanOrEqual(7);
    expect(
      memberships.some((item) => item.user.email === 'treasurer@igreja.com.br'),
    ).toBe(true);
  });

  it('pastor can change treasurer roles to member and back', async () => {
    const pastorAgent = await loginAs('pastor@igreja.com.br');

    const memberships = (
      await pastorAgent
        .get('/api/v1/churches/church_demo/memberships')
        .expect(200)
    ).body as E2eMembershipItem[];

    const treasurerMembership = memberships.find(
      (item) => item.user.email === 'treasurer@igreja.com.br',
    );
    const memberMembership = memberships.find(
      (item) => item.user.email === 'member@igreja.com.br',
    );

    expect(treasurerMembership).toBeDefined();
    expect(memberMembership).toBeDefined();

    const memberRoleId = memberMembership.roles[0]?.id;
    const treasurerRoleId = treasurerMembership.roles[0]?.id;

    expect(memberRoleId).toBeDefined();
    expect(treasurerRoleId).toBeDefined();

    await pastorAgent
      .patch(
        `/api/v1/churches/church_demo/memberships/${treasurerMembership.userId}`,
      )
      .send({ roleIds: [memberRoleId] })
      .expect(200);

    await pastorAgent
      .patch(
        `/api/v1/churches/church_demo/memberships/${treasurerMembership.userId}`,
      )
      .send({ roleIds: [treasurerRoleId] })
      .expect(200);
  });

  it('pastor cannot change admin roles', async () => {
    const pastorAgent = await loginAs('pastor@igreja.com.br');

    const memberships = (
      await pastorAgent
        .get('/api/v1/churches/church_demo/memberships')
        .expect(200)
    ).body as E2eMembershipItem[];

    const adminMembership = memberships.find(
      (item) => item.user.email === 'admin@igreja.com.br',
    );
    const memberMembership = memberships.find(
      (item) => item.user.email === 'member@igreja.com.br',
    );

    expect(adminMembership).toBeDefined();
    expect(memberMembership?.roles[0]).toBeDefined();

    await pastorAgent
      .patch(
        `/api/v1/churches/church_demo/memberships/${adminMembership!.userId}`,
      )
      .send({ roleIds: [memberMembership!.roles[0].id] })
      .expect(403);
  });

  it('member cannot list memberships', async () => {
    const agent = await loginAs('member@igreja.com.br');

    await agent.get('/api/v1/churches/church_demo/memberships').expect(403);
  });
});
