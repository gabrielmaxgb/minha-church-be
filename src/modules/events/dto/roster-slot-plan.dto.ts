import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export const ROSTER_SLOT_MAX_REQUIRED_COUNT = 50;

export class RosterSlotPlanItemDto {
  @IsString()
  label: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(ROSTER_SLOT_MAX_REQUIRED_COUNT)
  requiredCount?: number;
}

export function validateRosterSlotPlanDtoArray(
  value: unknown,
): RosterSlotPlanItemDto[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  return value as RosterSlotPlanItemDto[];
}

export const RosterSlotPlanArrayValidation = {
  IsOptional: true,
  IsArray: true,
  ValidateNested: { each: true },
  Type: () => RosterSlotPlanItemDto,
} as const;
