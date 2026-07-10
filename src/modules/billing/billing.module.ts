import { Module } from '@nestjs/common';

import { BillingController, BillingWebhookController, PricingController } from './billing.controller';
import { BillingTierController } from './billing-tier.controller';
import { BillingService } from './billing.service';

@Module({
  controllers: [BillingController, BillingTierController, BillingWebhookController, PricingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
