export function normalizeCnpj(value: string): string {
  return value.replace(/\D/g, '');
}

export function formatCnpj(cnpj: string): string {
  const digits = normalizeCnpj(cnpj);

  if (digits.length !== 14) {
    return digits || cnpj;
  }

  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

export function isValidCnpj(value: string): boolean {
  const cnpj = normalizeCnpj(value);

  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) {
    return false;
  }

  const calcCheckDigit = (length: number): number => {
    let sum = 0;
    let weight = length - 7;

    for (let index = 0; index < length; index += 1) {
      sum += Number(cnpj[index]) * weight;
      weight -= 1;

      if (weight < 2) {
        weight = 9;
      }
    }

    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  if (calcCheckDigit(12) !== Number(cnpj[12])) {
    return false;
  }

  return calcCheckDigit(13) === Number(cnpj[13]);
}
