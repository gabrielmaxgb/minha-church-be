import {
  IsDateString,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateChurchEventDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  ministryId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsDateString()
  startsAt: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;
}

export class ListChurchEventsQueryDto {
  @IsOptional()
  @IsString()
  ministryId?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  churchWideOnly?: boolean;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
