import {
  Equals,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * Identidade fiscal + contato mínimo da igreja no Minha Church.
 * Endereço completo / KYC / banco ficam no onboarding Stripe.
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

  /**
   * Obrigatório ao salvar como CPF: confirma que a igreja não tem CNPJ
   * (evita atalho de cadastrar PF só pra receber mais rápido).
   */
  @ValidateIf((dto: UpsertFiscalProfileDto) => dto.documentType === 'cpf')
  @Equals(true, {
    message:
      'Confirme que a igreja não possui CNPJ antes de cadastrar com CPF.',
  })
  confirmNoCnpj?: boolean;

  @IsString()
  @MinLength(8)
  @MaxLength(20)
  contactPhone!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  city!: string;

  @IsString()
  @Matches(/^[A-Za-z]{2}$/, { message: 'Informe a UF (2 letras).' })
  state!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  addressLine?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  zipCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  contactEmail?: string;
}
