import { ChurchDocumentType } from '@prisma/client';

import { isValidCnpj, normalizeCnpj } from '../../common/utils/cnpj';
import { isValidCpf, normalizeCpf } from '../../common/utils/cpf';

export interface FiscalProfileCompletenessInput {
  documentType: ChurchDocumentType;
  documentNumber: string;
  legalName: string;
  responsibleName: string;
  responsibleDocument?: string | null;
}

export type FiscalConnectRequiredField =
  | 'documentNumber'
  | 'legalName'
  | 'responsibleName'
  | 'responsibleDocument';

const FIELD_LABELS: Record<
  FiscalConnectRequiredField,
  { cnpj: string; cpf: string }
> = {
  documentNumber: { cnpj: 'CNPJ', cpf: 'CPF' },
  legalName: {
    cnpj: 'Razão social',
    cpf: 'Nome da igreja / responsável',
  },
  responsibleName: { cnpj: 'Responsável legal', cpf: 'Responsável legal' },
  responsibleDocument: {
    cnpj: 'CPF do responsável',
    cpf: 'CPF do responsável',
  },
};

function requiredFields(
  documentType: ChurchDocumentType | undefined,
): FiscalConnectRequiredField[] {
  const base: FiscalConnectRequiredField[] = [
    'documentNumber',
    'legalName',
    'responsibleName',
  ];

  if (documentType !== ChurchDocumentType.cpf) {
    base.push('responsibleDocument');
  }

  return base;
}

/** Identidade fiscal mínima no app — o que o Stripe não devolve depois. */
export function listMissingFiscalFieldsForConnect(
  profile: FiscalProfileCompletenessInput | null | undefined,
): Array<{ field: FiscalConnectRequiredField; label: string }> {
  const mode = profile?.documentType === ChurchDocumentType.cpf ? 'cpf' : 'cnpj';
  const required = requiredFields(profile?.documentType);

  if (!profile) {
    return required.map((field) => ({
      field,
      label: FIELD_LABELS[field][mode],
    }));
  }

  const missing: Array<{ field: FiscalConnectRequiredField; label: string }> =
    [];

  const push = (field: FiscalConnectRequiredField) => {
    missing.push({ field, label: FIELD_LABELS[field][mode] });
  };

  const documentDigits =
    profile.documentType === ChurchDocumentType.cnpj
      ? normalizeCnpj(profile.documentNumber)
      : normalizeCpf(profile.documentNumber);

  const documentOk =
    profile.documentType === ChurchDocumentType.cnpj
      ? isValidCnpj(documentDigits)
      : isValidCpf(documentDigits);

  if (!documentOk) {
    push('documentNumber');
  }

  if (profile.legalName.trim().length < 2) {
    push('legalName');
  }

  if (profile.responsibleName.trim().length < 2) {
    push('responsibleName');
  }

  if (profile.documentType === ChurchDocumentType.cnpj) {
    const cpf = normalizeCpf(profile.responsibleDocument ?? '');
    if (!isValidCpf(cpf)) {
      push('responsibleDocument');
    }
  }

  return missing;
}

export function isFiscalProfileReadyForConnect(
  profile: FiscalProfileCompletenessInput | null | undefined,
): boolean {
  return listMissingFiscalFieldsForConnect(profile).length === 0;
}

export interface OwnerOnboardingMinimumInput
  extends FiscalProfileCompletenessInput {
  contactPhone?: string | null;
  city?: string | null;
  state?: string | null;
}

export function isOwnerOnboardingMinimumComplete(
  profile: OwnerOnboardingMinimumInput | null | undefined,
): boolean {
  if (!isFiscalProfileReadyForConnect(profile)) {
    return false;
  }

  const phone = (profile?.contactPhone ?? '').replace(/\D/g, '');
  const city = (profile?.city ?? '').trim();
  const state = (profile?.state ?? '').trim();

  return (
    phone.length >= 10 &&
    phone.length <= 11 &&
    city.length >= 2 &&
    /^[A-Za-z]{2}$/.test(state)
  );
}
