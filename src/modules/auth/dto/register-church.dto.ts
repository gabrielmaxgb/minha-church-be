import {
  Equals,
  IsBoolean,
  IsEmail,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterChurchDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  churchName: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  ownerName: string;

  @IsEmail()
  @MaxLength(254)
  ownerEmail: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @IsBoolean()
  @Equals(true, {
    message: 'Você precisa aceitar os termos de uso.',
  })
  acceptTerms: boolean;
}
