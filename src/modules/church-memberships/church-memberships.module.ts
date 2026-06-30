import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { ChurchMembershipsController } from './church-memberships.controller';
import { ChurchMembershipsService } from './church-memberships.service';

@Module({
  imports: [UsersModule],
  controllers: [ChurchMembershipsController],
  providers: [ChurchMembershipsService],
})
export class ChurchMembershipsModule {}
