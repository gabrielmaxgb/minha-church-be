/**
 * Política de exclusão de categorias do caixa.
 *
 * - Contas de sistema (systemKey) nunca excluem.
 * - Seeds do plano padrão (createdByUserId null) só desativam —
 *   exclusão seria recriada em ensureDefaultAccounts.
 * - Com lançamentos, só desativa (preserva histórico).
 */
export function canDeleteFinanceAccount(input: {
  systemKey: string | null;
  createdByUserId: string | null | undefined;
  entryCount: number;
}): boolean {
  const isSystem = Boolean(input.systemKey);
  return (
    !isSystem &&
    input.entryCount === 0 &&
    Boolean(input.createdByUserId)
  );
}

export type FinanceAccountDeleteBlockReason =
  | 'system'
  | 'default_seed'
  | 'has_entries'
  | null;

export function financeAccountDeleteBlockReason(input: {
  systemKey: string | null;
  createdByUserId: string | null | undefined;
  entryCount: number;
}): FinanceAccountDeleteBlockReason {
  if (input.systemKey) {
    return 'system';
  }
  if (!input.createdByUserId) {
    return 'default_seed';
  }
  if (input.entryCount > 0) {
    return 'has_entries';
  }
  return null;
}
