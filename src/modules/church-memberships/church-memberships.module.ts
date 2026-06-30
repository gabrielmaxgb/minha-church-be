import { Module } from '@nestjs/common';

import { ChurchRolesModule } from '../church-roles/church-roles.module';
import { ChurchMembershipsController } from './church-memberships.controller';
import { ChurchMembershipsService } from './church-memberships.service';

@Module({
  imports: [ChurchRolesModule],
  controllers: [ChurchMembershipsController],
  providers: [ChurchMembershipsService],
})
export class ChurchMembershipsModule {}
