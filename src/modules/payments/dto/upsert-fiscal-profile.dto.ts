import {
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * Identidade fiscal da igreja no Minha Church.
 * Endereço/telefone/e-mail ficam fora do form — o Stripe coleta no onboarding;
 * se vierem via hydrate, permanecem no banco sem o usuário redigitar.
 */
export class UpsertFiscalProfileDto {
  @IsIn(['cnpj', 'cpf'])
  documentType!: 'cnpj' | 'cpf';

  @IsString()
  @MaxLength(20)
  documentNumber!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  legalName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  responsibleName!: string;

  /** Obrigatório com CNPJ (CPF do representante). No modo CPF, o documentNumber já basta. */
  @ValidateIf((dto: UpsertFiscalProfileDto) => dto.documentType === 'cnpj')
  @IsString()
  @IsNotEmpty({ message: 'Informe o CPF do responsável.' })
  @MaxLength(20)
  responsibleDocument?: string;
}
