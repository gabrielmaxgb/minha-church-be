import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

import { EventRecurrenceDto } from './event-recurrence.dto';
import {
  EVENT_MUTATION_SCOPES,
  type EventMutationScope,
} from './event-mutation-scope';

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

  @IsOptional()
  @ValidateNested()
  @Type(() => EventRecurrenceDto)
  recurrence?: EventRecurrenceDto;
}

export class UpdateChurchEventDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  location?: string | null;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;

  /** Escopo da edição em eventos recorrentes (padrão: só esta ocorrência). */
  @IsOptional()
  @IsIn(EVENT_MUTATION_SCOPES)
  scope?: EventMutationScope;
}

export class DeleteChurchEventQueryDto {
  @IsOptional()
  @IsIn(EVENT_MUTATION_SCOPES)
  scope?: EventMutationScope;
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
