import { Global, Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import {
  ChurchAccessGuard,
  PermissionsGuard,
} from './guards/church-access.guard';
import { ActivePlanGuard } from './guards/active-plan.guard';
import { TrialWriteGuard } from './guards/trial-write.guard';
import { ChurchPermissionsService } from './services/church-permissions.service';
import { AuditService } from './services/audit.service';
import { EmailService } from './services/email.service';
import { OnboardingPolicyService } from './services/onboarding-policy.service';
import { SubscriptionPolicyService } from './services/subscription-policy.service';
import { PasswordCredentialsService } from './services/password-credentials.service';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    ChurchAccessGuard,
    PermissionsGuard,
    ActivePlanGuard,
    TrialWriteGuard,
    ChurchPermissionsService,
    AuditService,
    EmailService,
    OnboardingPolicyService,
    SubscriptionPolicyService,
    PasswordCredentialsService,
  ],
  exports: [
    ChurchAccessGuard,
    PermissionsGuard,
    ActivePlanGuard,
    TrialWriteGuard,
    ChurchPermissionsService,
    AuditService,
    EmailService,
    OnboardingPolicyService,
    SubscriptionPolicyService,
    PasswordCredentialsService,
  ],
})
export class CommonModule {}
