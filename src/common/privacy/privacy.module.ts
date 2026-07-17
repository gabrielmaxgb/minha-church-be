import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { BillingModule } from '../../modules/billing/billing.module';
import { PaymentsModule } from '../../modules/payments/payments.module';
import { AccountLifecycleService } from './account-lifecycle.service';
import { ChurchPrivacyController } from './church-privacy.controller';
import { DataExportService } from './data-export.service';
import { LegalAcceptanceService } from './legal-acceptance.service';
import { RetentionService } from './retention.service';

@Module({
  imports: [DatabaseModule, PaymentsModule, BillingModule],
  controllers: [ChurchPrivacyController],
  providers: [
    LegalAcceptanceService,
    DataExportService,
    RetentionService,
    AccountLifecycleService,
  ],
  exports: [
    LegalAcceptanceService,
    DataExportService,
    RetentionService,
    AccountLifecycleService,
  ],
})
export class PrivacyModule {}
