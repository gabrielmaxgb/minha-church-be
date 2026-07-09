import { Module } from '@nestjs/common';

import { ChurchRegistrationService } from './church-registration.service';
import { ChurchesService } from './churches.service';

@Module({
  providers: [ChurchesService, ChurchRegistrationService],
  exports: [ChurchesService, ChurchRegistrationService],
})
export class ChurchesModule {}
