/** Versão do texto de consentimento parental gravada no registro. */
export const PARENTAL_CONSENT_VERSION = 'parental-consent-mvp-1';

export const PARENTAL_CONSENT_TEXT =
  'Autorizo o tratamento dos dados deste menor para gestão pastoral desta igreja no Minha Church (cadastro, escalas e comunicação operacional da comunidade).';

export const ADULT_AGE = 18;

export function getAgeFromBirthDate(
  birthDate: Date | string | null | undefined,
  referenceDate = new Date(),
): number | null {
  if (!birthDate) {
    return null;
  }

  const birth =
    typeof birthDate === 'string' ? new Date(birthDate) : birthDate;

  if (Number.isNaN(birth.getTime())) {
    return null;
  }

  let age = referenceDate.getFullYear() - birth.getFullYear();
  const monthDiff = referenceDate.getMonth() - birth.getMonth();

  if (
    monthDiff < 0 ||
    (monthDiff === 0 && referenceDate.getDate() < birth.getDate())
  ) {
    age -= 1;
  }

  return age;
}

/** Menor de 18 com data de nascimento conhecida. Sem data → não trata como menor no produto. */
export function isMinorByBirthDate(
  birthDate: Date | string | null | undefined,
  referenceDate = new Date(),
): boolean {
  const age = getAgeFromBirthDate(birthDate, referenceDate);
  return age !== null && age < ADULT_AGE;
}

export function hasParentalConsent(member: {
  parentalConsentAt: Date | string | null | undefined;
}): boolean {
  return Boolean(member.parentalConsentAt);
}

export function requiresParentalConsentForAppAccess(member: {
  birthDate: Date | string | null | undefined;
  parentalConsentAt: Date | string | null | undefined;
}): boolean {
  return (
    isMinorByBirthDate(member.birthDate) && !hasParentalConsent(member)
  );
}
