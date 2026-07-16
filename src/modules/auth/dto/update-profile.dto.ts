import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Gender, MaritalStatus } from '@prisma/client';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsString()
  phoneSecondary?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsDateString()
  birthDate?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsEnum(Gender)
  gender?: Gender | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsEnum(MaritalStatus)
  maritalStatus?: MaritalStatus | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsDateString()
  weddingAnniversary?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  street?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  number?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  complement?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  neighborhood?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsString()
  @Length(2, 2)
  state?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  zipCode?: string | null;
}
