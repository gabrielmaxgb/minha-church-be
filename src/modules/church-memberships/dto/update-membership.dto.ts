import { IsEnum } from 'class-validator';
import { UserRole } from '@prisma/client';

export class UpdateMembershipDto {
  @IsEnum(UserRole)
  role: UserRole;
}
