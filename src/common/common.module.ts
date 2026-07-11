import { Global, Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import {
  ChurchAccessGuard,
  PermissionsGuard,
} from './guards/church-access.guard';
import { ChurchOwnerGuard } from './guards/church-owner.guard';
import { SubscriptionWriteGuard } from './guards/subscription-write.guard';
import { ChurchPermissionsService } from './services/church-permissions.service';
import { SubscriptionPolicyService } from './services/subscription-policy.service';
import { AuditService } from './services/audit.service';
import { EmailService } from './services/email.service';
import { PasswordCredentialsService } from './services/password-credentials.service';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    JwtAuthGuard,
    ChurchAccessGuard,
    PermissionsGuard,
    ChurchOwnerGuard,
    SubscriptionWriteGuard,
    ChurchPermissionsService,
    SubscriptionPolicyService,
    AuditService,
    EmailService,
    PasswordCredentialsService,
  ],
  exports: [
    JwtAuthGuard,
    ChurchAccessGuard,
    PermissionsGuard,
    ChurchOwnerGuard,
    SubscriptionWriteGuard,
    ChurchPermissionsService,
    SubscriptionPolicyService,
    AuditService,
    EmailService,
    PasswordCredentialsService,
  ],
})
export class CommonModule {}
