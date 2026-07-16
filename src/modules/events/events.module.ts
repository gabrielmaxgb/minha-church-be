import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';
import { EventCreationService } from './event-creation.service';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [UsersModule, NotificationsModule, PaymentsModule],
  controllers: [EventsController],
  providers: [EventsService, EventCreationService],
  exports: [EventsService, EventCreationService],
})
export class EventsModule {}
