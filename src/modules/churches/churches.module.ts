import { Module } from '@nestjs/common';

import { ChurchesService } from './churches.service';

@Module({
  providers: [ChurchesService],
  exports: [ChurchesService],
})
export class ChurchesModule {}
