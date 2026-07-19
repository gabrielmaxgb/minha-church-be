import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { FinanceEntryMethod, FinanceEntryType } from '@prisma/client';
import { GIVING_MAX_AMOUNT_CENTS } from './create-giving-checkout.dto';

export class CreateFinanceEntryDto {
  @IsEnum(FinanceEntryType)
  type!: FinanceEntryType;

  @IsInt()
  @Min(1)
  @Max(GIVING_MAX_AMOUNT_CENTS)
  amountCents!: number;

  @IsDateString()
  occurredOn!: string;

  /** Preferencial — plano de contas. */
  @IsOptional()
  @IsString()
  accountId?: string;

  /** Legado / fallback se accountId não for enviado. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsString()
  fundId?: string;

  @IsOptional()
  @IsEnum(FinanceEntryMethod)
  method?: FinanceEntryMethod;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateFinanceEntryDto {
  @IsOptional()
  @IsEnum(FinanceEntryType)
  type?: FinanceEntryType;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(GIVING_MAX_AMOUNT_CENTS)
  amountCents?: number;

  @IsOptional()
  @IsDateString()
  occurredOn?: string;

  @IsOptional()
  @IsString()
  accountId?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsString()
  fundId?: string | null;

  @IsOptional()
  @IsEnum(FinanceEntryMethod)
  method?: FinanceEntryMethod;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}
