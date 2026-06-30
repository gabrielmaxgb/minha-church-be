import { Module } from '@nestjs/common';

import { ChurchRolesController } from './church-roles.controller';
import { ChurchRolesService } from './church-roles.service';

@Module({
  controllers: [ChurchRolesController],
  providers: [ChurchRolesService],
  exports: [ChurchRolesService],
})
export class ChurchRolesModule {}
