import { Module } from '@nestjs/common';

import { PrayerRequestsController } from './prayer-requests.controller';
import { PrayerRequestsService } from './prayer-requests.service';

@Module({
  controllers: [PrayerRequestsController],
  providers: [PrayerRequestsService],
  exports: [PrayerRequestsService],
})
export class PrayerRequestsModule {}
