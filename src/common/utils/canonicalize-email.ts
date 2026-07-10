export interface CanonicalizeEmailOptions {
  /**
   * Quando true (padrão em produção), aliases Gmail (+tag) e pontos
   * no local-part colapsam para o mesmo e-mail canônico.
   * Em dev/test o padrão é false — cada alias vira conta separada.
   */
  strictGmailAliases?: boolean;
}

function isStrictGmailAliases(options?: CanonicalizeEmailOptions): boolean {
  if (options?.strictGmailAliases !== undefined) {
    return options.strictGmailAliases;
  }

  return process.env.NODE_ENV === 'production';
}

/**
 * Normaliza e-mail para deduplicação de contas.
 */
export function canonicalizeEmail(
  email: string,
  options?: CanonicalizeEmailOptions,
): string {
  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.lastIndexOf('@');

  if (atIndex <= 0) {
    return trimmed;
  }

  let local = trimmed.slice(0, atIndex);
  let domain = trimmed.slice(atIndex + 1);

  if (!isStrictGmailAliases(options)) {
    return trimmed;
  }

  if (domain === 'googlemail.com') {
    domain = 'gmail.com';
  }

  if (domain === 'gmail.com') {
    const plusIndex = local.indexOf('+');

    if (plusIndex !== -1) {
      local = local.slice(0, plusIndex);
    }

    local = local.replace(/\./g, '');
  }

  return `${local}@${domain}`;
}
