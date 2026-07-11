import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { EventsModule } from '../events/events.module';
import { MinistriesController } from './ministries.controller';
import { MinistriesService } from './ministries.service';
import { RosterController } from './roster.controller';

@Module({
  imports: [UsersModule, EventsModule],
  controllers: [MinistriesController, RosterController],
  providers: [MinistriesService],
  exports: [MinistriesService],
})
export class MinistriesModule {}
