import { Module } from '@nestjs/common';

import { CareRequestsController } from './care-requests.controller';
import { CareRequestsService } from './care-requests.service';

@Module({
  controllers: [CareRequestsController],
  providers: [CareRequestsService],
  exports: [CareRequestsService],
})
export class CareRequestsModule {}
