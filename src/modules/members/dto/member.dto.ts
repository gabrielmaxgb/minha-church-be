import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Gender, MaritalStatus, MemberStatus } from '@prisma/client';

export class CreateMemberDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  cpf?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  phoneSecondary?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsEnum(MaritalStatus)
  maritalStatus?: MaritalStatus;

  @ValidateIf(
    (dto: CreateMemberDto) => dto.maritalStatus === MaritalStatus.married,
  )
  @IsOptional()
  @IsDateString()
  weddingAnniversary?: string;

  @IsOptional()
  @IsString()
  street?: string;

  @IsOptional()
  @IsString()
  number?: string;

  @IsOptional()
  @IsString()
  complement?: string;

  @IsOptional()
  @IsString()
  neighborhood?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  zipCode?: string;

  @IsOptional()
  @IsEnum(MemberStatus)
  status?: MemberStatus;

  @IsOptional()
  @IsDateString()
  visitorSince?: string;

  @IsOptional()
  @IsDateString()
  baptismDate?: string;

  @IsOptional()
  @IsDateString()
  membershipDate?: string;

  @IsOptional()
  @IsString()
  familyId?: string;
}

export class UpdateMemberDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  cpf?: string | null;

  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsString()
  phoneSecondary?: string | null;

  @IsOptional()
  @IsDateString()
  birthDate?: string | null;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender | null;

  @IsOptional()
  @IsEnum(MaritalStatus)
  maritalStatus?: MaritalStatus | null;

  @IsOptional()
  @IsDateString()
  weddingAnniversary?: string | null;

  @IsOptional()
  @IsString()
  street?: string | null;

  @IsOptional()
  @IsString()
  number?: string | null;

  @IsOptional()
  @IsString()
  complement?: string | null;

  @IsOptional()
  @IsString()
  neighborhood?: string | null;

  @IsOptional()
  @IsString()
  city?: string | null;

  @IsOptional()
  @IsString()
  state?: string | null;

  @IsOptional()
  @IsString()
  zipCode?: string | null;

  @IsOptional()
  @IsEnum(MemberStatus)
  status?: MemberStatus;

  @IsOptional()
  @IsDateString()
  visitorSince?: string | null;

  @IsOptional()
  @IsDateString()
  baptismDate?: string | null;

  @IsOptional()
  @IsDateString()
  membershipDate?: string | null;

  @IsOptional()
  @IsString()
  familyId?: string | null;
}

export class AssignMemberMinistryDto {
  @IsString()
  ministryId: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ministryRoleIds?: string[];

  @IsOptional()
  @IsDateString()
  startedAt?: string;
}

export class AckMinistryCatalogNotificationsDto {
  @IsArray()
  @IsString({ each: true })
  ministryIds: string[];
}

export class ListMembersQueryDto {
  @IsOptional()
  @IsEnum(MemberStatus)
  status?: MemberStatus;

  @IsOptional()
  @IsString()
  search?: string;

  /** Filtra por família. Use "none" para membros sem família. */
  @IsOptional()
  @IsString()
  familyId?: string;

  @IsOptional()
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  limit?: number;
}

export class CreateFamilyDto {
  @IsString()
  @MinLength(2)
  name: string;
}

export class CreateMemberRelationDto {
  @IsString()
  fromMemberId: string;

  @IsString()
  toMemberId: string;

  @IsEnum(['spouse', 'parent'] as const)
  type: 'spouse' | 'parent';
}
