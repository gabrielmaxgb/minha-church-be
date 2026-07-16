import { Module } from '@nestjs/common';

import {
  PaymentsConnectWebhookController,
  PaymentsController,
  PaymentsPublicGivingController,
} from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeConnectService } from './stripe-connect.service';

@Module({
  controllers: [
    PaymentsController,
    PaymentsPublicGivingController,
    PaymentsConnectWebhookController,
  ],
  providers: [PaymentsService, StripeConnectService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
