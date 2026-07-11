import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ChurchPermission } from '@prisma/client';

export class CreateChurchRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsArray()
  @IsEnum(ChurchPermission, { each: true })
  permissions: ChurchPermission[];

  @IsOptional()
  @IsBoolean()
  singleHolder?: boolean;
}

export class UpdateChurchRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsArray()
  @IsEnum(ChurchPermission, { each: true })
  permissions?: ChurchPermission[];

  @IsOptional()
  @IsBoolean()
  singleHolder?: boolean;
}
