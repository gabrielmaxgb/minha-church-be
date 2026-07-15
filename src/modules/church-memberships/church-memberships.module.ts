import { Module } from '@nestjs/common';

import { ChurchRolesModule } from '../church-roles/church-roles.module';
import { MembersModule } from '../members/members.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChurchMembershipsController } from './church-memberships.controller';
import { ChurchMembershipsService } from './church-memberships.service';

@Module({
  imports: [ChurchRolesModule, MembersModule, NotificationsModule],
  controllers: [ChurchMembershipsController],
  providers: [ChurchMembershipsService],
})
export class ChurchMembershipsModule {}
