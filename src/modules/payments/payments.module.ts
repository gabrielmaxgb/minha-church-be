import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';
import {
  PaymentsConnectWebhookController,
  PaymentsController,
  PaymentsPublicGivingController,
} from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeConnectService } from './stripe-connect.service';
import { TreasuryController } from './treasury.controller';
import { TreasuryService } from './treasury.service';

@Module({
  imports: [NotificationsModule],
  controllers: [
    PaymentsController,
    PaymentsPublicGivingController,
    PaymentsConnectWebhookController,
    TreasuryController,
  ],
  providers: [PaymentsService, StripeConnectService, TreasuryService],
  exports: [PaymentsService, TreasuryService],
})
export class PaymentsModule {}
