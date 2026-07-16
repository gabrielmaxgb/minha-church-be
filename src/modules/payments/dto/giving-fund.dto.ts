import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { GivingFundAudience } from '@prisma/client';

export class CreateGivingFundDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;

  @IsEnum(GivingFundAudience)
  audience!: GivingFundAudience;

  @IsBoolean()
  allowPix!: boolean;

  @IsBoolean()
  allowCard!: boolean;

  @IsBoolean()
  allowBoleto!: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateGivingFundDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  allowPix?: boolean;

  @IsOptional()
  @IsBoolean()
  allowCard?: boolean;

  @IsOptional()
  @IsBoolean()
  allowBoleto?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
