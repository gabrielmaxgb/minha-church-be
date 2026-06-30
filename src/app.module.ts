import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import configuration from './config/configuration';
import { CommonModule } from './common/common.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { MembersModule } from './modules/members/members.module';
import { MinistriesModule } from './modules/ministries/ministries.module';
import { EventsModule } from './modules/events/events.module';
import { ChurchMembershipsModule } from './modules/church-memberships/church-memberships.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    DatabaseModule,
    CommonModule,
    AuthModule,
    DashboardModule,
    MembersModule,
    MinistriesModule,
    EventsModule,
    ChurchMembershipsModule,
  ],
})
export class AppModule {}
