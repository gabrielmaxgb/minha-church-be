import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateMembershipDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  roleIds?: string[];
}
