import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { ChurchesService } from './churches.service';

@Module({
  imports: [ConfigModule],
  providers: [ChurchesService],
  exports: [ChurchesService],
})
export class ChurchesModule {}
