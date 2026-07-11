import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { EventCreationService } from './event-creation.service';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [UsersModule],
  controllers: [EventsController],
  providers: [EventsService, EventCreationService],
  exports: [EventsService, EventCreationService],
})
export class EventsModule {}
