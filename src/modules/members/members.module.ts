import { Module } from '@nestjs/common';

import { BillingModule } from '../billing/billing.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';
import { MembersController } from './members.controller';
import { FamiliesController } from './families.controller';
import { MembersService } from './members.service';

@Module({
  imports: [UsersModule, BillingModule, PaymentsModule, NotificationsModule],
  controllers: [MembersController, FamiliesController],
  providers: [MembersService],
  exports: [MembersService],
})
export class MembersModule {}
