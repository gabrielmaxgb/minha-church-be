import { Global, Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import {
  ChurchAccessGuard,
  PermissionsGuard,
} from './guards/church-access.guard';
import { ChurchPermissionsService } from './services/church-permissions.service';
import { AuditService } from './services/audit.service';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    ChurchAccessGuard,
    PermissionsGuard,
    ChurchPermissionsService,
    AuditService,
  ],
  exports: [
    ChurchAccessGuard,
    PermissionsGuard,
    ChurchPermissionsService,
    AuditService,
  ],
})
export class CommonModule {}
