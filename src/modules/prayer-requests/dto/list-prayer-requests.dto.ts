import { IsIn, IsOptional } from 'class-validator';

export class ListPrayerRequestsQueryDto {
  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: 'active' | 'archived';
}
