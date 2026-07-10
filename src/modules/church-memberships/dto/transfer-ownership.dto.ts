import { IsString, MinLength } from 'class-validator';

export class TransferOwnershipDto {
  @IsString()
  @MinLength(1, { message: 'Informe sua senha para confirmar.' })
  password: string;
}
