import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateMembershipDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  roleIds?: string[];

  @IsOptional()
  @IsBoolean()
  isOwner?: boolean;
}
