import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreatePrayerRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  body: string;

  @IsOptional()
  @IsBoolean()
  isAnonymous?: boolean;
}
