import { Global, Module } from '@nestjs/common';

import { UsersModule } from '../modules/users/users.module';
import { ChurchAccessGuard, RolesGuard } from './guards/church-access.guard';
import { ChurchPermissionsService } from './services/church-permissions.service';

@Global()
@Module({
  imports: [UsersModule],
  providers: [ChurchAccessGuard, RolesGuard, ChurchPermissionsService],
  exports: [ChurchAccessGuard, RolesGuard, ChurchPermissionsService],
})
export class CommonModule {}
