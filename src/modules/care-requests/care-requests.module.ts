import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';
import { CareRequestsController } from './care-requests.controller';
import { CareRequestsService } from './care-requests.service';

@Module({
  imports: [NotificationsModule],
  controllers: [CareRequestsController],
  providers: [CareRequestsService],
  exports: [CareRequestsService],
})
export class CareRequestsModule {}
