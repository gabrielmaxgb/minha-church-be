import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Valor mínimo R$ 5,00 — evita cobranças de teste irrisórias e bate com mínimos comuns do BR. */
export const GIVING_MIN_AMOUNT_CENTS = 500;
/** Valor máximo R$ 100.000,00 por contribuição avulsa. */
export const GIVING_MAX_AMOUNT_CENTS = 10_000_000;

export class CreateGivingCheckoutDto {
  @IsInt()
  @Min(GIVING_MIN_AMOUNT_CENTS)
  @Max(GIVING_MAX_AMOUNT_CENTS)
  amountCents!: number;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  payerName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  payerEmail?: string;

  /** Contribuição mensal (cartão). Default: false. */
  @IsOptional()
  @IsBoolean()
  recurring?: boolean;

  /**
   * Se true, não vincula à ficha mesmo com sessão de membro.
   * Default: false (vincula quando logado na mesma igreja).
   */
  @IsOptional()
  @IsBoolean()
  anonymous?: boolean;
}
