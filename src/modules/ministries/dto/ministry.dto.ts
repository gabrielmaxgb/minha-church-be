import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { EventRecurrenceDto } from '../../events/dto/event-recurrence.dto';

export const EVENT_AVAILABILITY_STATUSES = [
  'available',
  'unavailable',
] as const;

export class CreateMinistryDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  hasRoster?: boolean;
}

export class UpdateMinistryDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  hasRoster?: boolean;
}

export class UpdateRosterProfileDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  instruments: string[];
}

export class UpdateEventAvailabilityDto {
  @IsIn([...EVENT_AVAILABILITY_STATUSES, 'clear'])
  status: 'available' | 'unavailable' | 'clear';
}

export class CreateMinistryRoleDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  canManageEvents?: boolean;

  @IsOptional()
  @IsBoolean()
  canManageRoster?: boolean;
}

export class UpdateMinistryRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  canManageEvents?: boolean;

  @IsOptional()
  @IsBoolean()
  canManageRoster?: boolean;
}

export class CreateMinistryEventDto {
  @IsString()
  @MinLength(2)
  name: string;

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

  /** Abre o evento para a equipe marcar disponibilidade. */
  @IsOptional()
  @IsBoolean()
  rosterOpen?: boolean;
}

export class UpdateMinistryEventDto {
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

  @IsOptional()
  @IsBoolean()
  rosterOpen?: boolean;

  @IsOptional()
  @IsIn(['this', 'this_and_following', 'all'])
  scope?: 'this' | 'this_and_following' | 'all';
}

export class DeleteMinistryEventQueryDto {
  @IsOptional()
  @IsIn(['this', 'this_and_following', 'all'])
  scope?: 'this' | 'this_and_following' | 'all';
}

export class ListMinistryEventsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export const WORSHIP_AVAILABILITY_PERIOD_VALUES = [
  'weekly',
  'monthly',
  'quarterly',
  'semiannual',
  'annual',
] as const;

export class OpenAvailabilityWindowDto {
  @IsIn(WORSHIP_AVAILABILITY_PERIOD_VALUES)
  periodType: (typeof WORSHIP_AVAILABILITY_PERIOD_VALUES)[number];

  @IsOptional()
  @IsDateString()
  startDate?: string;
}
