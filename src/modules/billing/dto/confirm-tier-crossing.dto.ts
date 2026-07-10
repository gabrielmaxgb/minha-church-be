import { IsIn } from 'class-validator';

import { BILLING_TIER_IDS } from '../../../config/billing-plans.config';

export class ConfirmTierCrossingDto {
  @IsIn(BILLING_TIER_IDS)
  targetTierId!: (typeof BILLING_TIER_IDS)[number];
}
