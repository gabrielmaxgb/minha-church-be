import { Global, Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import {
  ChurchAccessGuard,
  PermissionsGuard,
} from './guards/church-access.guard';
import { ChurchPermissionsService } from './services/church-permissions.service';
import { AuditService } from './services/audit.service';
import { EmailService } from './services/email.service';
import { OnboardingPolicyService } from './services/onboarding-policy.service';
import { PasswordCredentialsService } from './services/password-credentials.service';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    ChurchAccessGuard,
    PermissionsGuard,
    ChurchPermissionsService,
    AuditService,
    EmailService,
    OnboardingPolicyService,
    PasswordCredentialsService,
  ],
  exports: [
    ChurchAccessGuard,
    PermissionsGuard,
    ChurchPermissionsService,
    AuditService,
    EmailService,
    OnboardingPolicyService,
    PasswordCredentialsService,
  ],
})
export class CommonModule {}
