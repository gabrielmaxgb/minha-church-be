import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CareRequestType } from '@prisma/client';

export class CreateCareRequestDto {
  @IsString()
  @MinLength(1)
  recipientMemberId: string;

  @IsEnum(CareRequestType)
  type: CareRequestType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
