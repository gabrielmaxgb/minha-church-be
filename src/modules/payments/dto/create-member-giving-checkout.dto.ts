import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

import {
  GIVING_MAX_AMOUNT_CENTS,
  GIVING_MIN_AMOUNT_CENTS,
} from './create-giving-checkout.dto';

/** Checkout autenticado — valor apenas; doador vem do membro logado. */
export class CreateMemberGivingCheckoutDto {
  @IsInt()
  @Min(GIVING_MIN_AMOUNT_CENTS)
  @Max(GIVING_MAX_AMOUNT_CENTS)
  amountCents!: number;

  /** Contribuição mensal (cartão). Default: false. */
  @IsOptional()
  @IsBoolean()
  recurring?: boolean;
}
