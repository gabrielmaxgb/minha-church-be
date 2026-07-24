import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { EventNoteVisibility } from '@prisma/client';

export class CreateEventNoteDto {
  @IsString()
  @MaxLength(20000)
  body!: string;

  @IsEnum(EventNoteVisibility)
  visibility!: EventNoteVisibility;

  /** Obrigatório quando visibility = private. */
  @ValidateIf((dto: CreateEventNoteDto) => dto.visibility === 'private')
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @Type(() => String)
  roleIds?: string[];
}

export class UpdateEventNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  body?: string;

  @IsOptional()
  @IsEnum(EventNoteVisibility)
  visibility?: EventNoteVisibility;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @Type(() => String)
  roleIds?: string[];
}
