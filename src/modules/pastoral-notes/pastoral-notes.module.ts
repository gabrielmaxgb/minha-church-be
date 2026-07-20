import { Module } from '@nestjs/common';

import { PastoralNotesController } from './pastoral-notes.controller';
import { PastoralNotesService } from './pastoral-notes.service';

@Module({
  controllers: [PastoralNotesController],
  providers: [PastoralNotesService],
  exports: [PastoralNotesService],
})
export class PastoralNotesModule {}
