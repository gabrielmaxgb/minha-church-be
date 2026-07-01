export function normalizeCpf(value: string): string {
  return value.replace(/\D/g, '');
}

export function formatCpf(cpf: string): string {
  const digits = normalizeCpf(cpf);

  if (digits.length !== 11) {
    return valueOrDigits(cpf, digits);
  }

  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function valueOrDigits(original: string, digits: string): string {
  return digits || original;
}

export function isValidCpf(value: string): boolean {
  const cpf = normalizeCpf(value);

  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) {
    return false;
  }

  let sum = 0;

  for (let index = 0; index < 9; index += 1) {
    sum += Number(cpf[index]) * (10 - index);
  }

  let remainder = (sum * 10) % 11;
  if (remainder === 10) {
    remainder = 0;
  }

  if (remainder !== Number(cpf[9])) {
    return false;
  }

  sum = 0;

  for (let index = 0; index < 10; index += 1) {
    sum += Number(cpf[index]) * (11 - index);
  }

  remainder = (sum * 10) % 11;
  if (remainder === 10) {
    remainder = 0;
  }

  return remainder === Number(cpf[10]);
}

export function cpfToInternalEmail(cpf: string): string {
  return `cpf+${normalizeCpf(cpf)}@accounts.minhachurch.app`;
}
