import { IsIn } from 'class-validator';

import type { BillingInterval } from '../../../config/billing-plans.config';

export class CreateCheckoutDto {
  @IsIn(['monthly', 'yearly'])
  interval!: BillingInterval;
}
