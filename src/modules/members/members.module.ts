import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  imports: [UsersModule],
  controllers: [MembersController],
  providers: [MembersService],
  exports: [MembersService],
})
export class MembersModule {}
