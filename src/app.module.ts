import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import configuration from './config/configuration';
import { CommonModule } from './common/common.module';
import { SubscriptionWriteGuard } from './common/guards/subscription-write.guard';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { MembersModule } from './modules/members/members.module';
import { MinistriesModule } from './modules/ministries/ministries.module';
import { EventsModule } from './modules/events/events.module';
import { ChurchMembershipsModule } from './modules/church-memberships/church-memberships.module';
import { ChurchRolesModule } from './modules/church-roles/church-roles.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
    }),
    DatabaseModule,
    CommonModule,
    AuthModule,
    BillingModule,
    DashboardModule,
    MembersModule,
    MinistriesModule,
    EventsModule,
    ChurchMembershipsModule,
    ChurchRolesModule,
    AuditLogsModule,
    AnnouncementsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: SubscriptionWriteGuard,
    },
  ],
})
export class AppModule {}
