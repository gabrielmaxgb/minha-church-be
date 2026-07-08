import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AnnouncementAudienceType, AnnouncementPriority } from '@prisma/client';

const TITLE_MAX = 160;
const BODY_MAX = 5000;
const MAX_TARGET_MINISTRIES = 50;

export class CreateAnnouncementDto {
  @IsString()
  @MinLength(2)
  @MaxLength(TITLE_MAX)
  title: string;

  @IsString()
  @MinLength(1)
  @MaxLength(BODY_MAX)
  body: string;

  @IsOptional()
  @IsEnum(AnnouncementPriority)
  priority?: AnnouncementPriority;

  @IsEnum(AnnouncementAudienceType)
  audienceType: AnnouncementAudienceType;

  /** Obrigatório quando audienceType = ministries. Ignorado para church_wide. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TARGET_MINISTRIES)
  @IsString({ each: true })
  ministryIds?: string[];

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  /** Ausente = publica agora. Data futura = agenda a publicação. */
  @IsOptional()
  @IsDateString()
  publishedAt?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;
}

export class UpdateAnnouncementDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(TITLE_MAX)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(BODY_MAX)
  body?: string;

  @IsOptional()
  @IsEnum(AnnouncementPriority)
  priority?: AnnouncementPriority;

  @IsOptional()
  @IsEnum(AnnouncementAudienceType)
  audienceType?: AnnouncementAudienceType;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TARGET_MINISTRIES)
  @IsString({ each: true })
  ministryIds?: string[];

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsDateString()
  publishedAt?: string | null;

  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;
}
