import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { MinistriesController } from './ministries.controller';
import { MinistriesService } from './ministries.service';

@Module({
  imports: [UsersModule],
  controllers: [MinistriesController],
  providers: [MinistriesService],
  exports: [MinistriesService],
})
export class MinistriesModule {}
