import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PastoralNoteType } from '@prisma/client';

export class CreatePastoralNoteDto {
  @IsString()
  memberId!: string;

  @IsEnum(PastoralNoteType)
  type!: PastoralNoteType;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;

  @IsDateString()
  occurredOn!: string;

  @IsOptional()
  @IsDateString()
  followUpOn?: string | null;
}

export class UpdatePastoralNoteDto {
  @IsOptional()
  @IsEnum(PastoralNoteType)
  type?: PastoralNoteType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body?: string;

  @IsOptional()
  @IsDateString()
  occurredOn?: string;

  @IsOptional()
  @IsDateString()
  followUpOn?: string | null;
}
