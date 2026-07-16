import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import configuration from './config/configuration';
import { CommonModule } from './common/common.module';
import { SubscriptionWriteGuard } from './common/guards/subscription-write.guard';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { BillingModule } from './modules/billing/billing.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { MembersModule } from './modules/members/members.module';
import { MinistriesModule } from './modules/ministries/ministries.module';
import { EventsModule } from './modules/events/events.module';
import { ChurchMembershipsModule } from './modules/church-memberships/church-memberships.module';
import { ChurchRolesModule } from './modules/church-roles/church-roles.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { CareRequestsModule } from './modules/care-requests/care-requests.module';
import { PrayerRequestsModule } from './modules/prayer-requests/prayer-requests.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PrivacyModule } from './common/privacy/privacy.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ScheduleModule.forRoot(),
    // Default por IP: painel autenticado (várias queries em paralelo).
    // Rotas sensíveis sobrescrevem com @Throttle / @SkipThrottle.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 200 }],
    }),
    DatabaseModule,
    CommonModule,
    PrivacyModule,
    AuthModule,
    BillingModule,
    PaymentsModule,
    DashboardModule,
    MembersModule,
    MinistriesModule,
    EventsModule,
    ChurchMembershipsModule,
    ChurchRolesModule,
    AuditLogsModule,
    AnnouncementsModule,
    CareRequestsModule,
    PrayerRequestsModule,
    NotificationsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: SubscriptionWriteGuard,
    },
  ],
})
export class AppModule {}
