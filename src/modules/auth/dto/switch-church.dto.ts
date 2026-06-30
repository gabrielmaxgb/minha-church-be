import { IsString, MinLength } from 'class-validator';

export class SwitchChurchDto {
  @IsString()
  @MinLength(1)
  churchId: string;
}
