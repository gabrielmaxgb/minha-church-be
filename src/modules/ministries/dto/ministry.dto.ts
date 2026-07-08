import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { EventRecurrenceDto } from '../../events/dto/event-recurrence.dto';
import { RosterSlotPlanItemDto } from '../../events/dto/roster-slot-plan.dto';

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
}

export class UpdateRosterProfileDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  instruments: string[];
}

export class ReplaceMinistryServiceFunctionsDto {
  @IsArray()
  @IsString({ each: true })
  labels: string[];
}

export class UpdateMemberMinistryInstrumentsDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  instruments: string[];
}

export class UpdateEventAvailabilityDto {
  @IsIn([...EVENT_AVAILABILITY_STATUSES, 'clear'])
  status: 'available' | 'unavailable' | 'clear';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roleLabels?: string[];
}

export class UpdateEventRoleProfileDto {
  @IsArray()
  @IsString({ each: true })
  roleLabels: string[];
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
  @MaxLength(1000)
  availabilityMessage?: string;

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

  /** Este evento participa do fluxo de escala (disponibilidade e montagem). */
  @IsOptional()
  @IsBoolean()
  usesRoster?: boolean;

  /** Abre o evento para a equipe marcar disponibilidade (requer usesRoster). */
  @IsOptional()
  @IsBoolean()
  rosterOpen?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  rosterRoles?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RosterSlotPlanItemDto)
  rosterSlotPlan?: RosterSlotPlanItemDto[];

  @IsOptional()
  @IsBoolean()
  visibleToChurch?: boolean;
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
  @MaxLength(1000)
  availabilityMessage?: string | null;

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
  usesRoster?: boolean;

  @IsOptional()
  @IsBoolean()
  rosterOpen?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  rosterRoles?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RosterSlotPlanItemDto)
  rosterSlotPlan?: RosterSlotPlanItemDto[];

  @IsOptional()
  @IsBoolean()
  visibleToChurch?: boolean;

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

export class UpdateRosterCollectionDto {
  @IsBoolean()
  rosterOpen: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  eventIds?: string[];

  @IsOptional()
  @IsString()
  recurrenceSeriesId?: string;
}
