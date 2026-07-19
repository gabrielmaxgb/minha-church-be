import { FinanceAccountKind } from '@prisma/client';

/** Contas de sistema usadas para agregar receitas online nos relatórios. */
export const FINANCE_SYSTEM_KEYS = {
  onlineDonations: 'online_donations',
  eventTickets: 'event_tickets',
} as const;

export type FinanceSystemKey =
  (typeof FINANCE_SYSTEM_KEYS)[keyof typeof FINANCE_SYSTEM_KEYS];

export type DefaultFinanceAccountSeed = {
  name: string;
  kind: FinanceAccountKind;
  sortOrder: number;
  systemKey?: FinanceSystemKey;
};

/**
 * Plano de contas genérico para igrejas evangélicas no Brasil.
 * Sem jargão denominacional — o tesoureiro pode renomear/desativar.
 */
export const DEFAULT_FINANCE_ACCOUNTS: DefaultFinanceAccountSeed[] = [
  {
    name: 'Dízimos',
    kind: FinanceAccountKind.income,
    sortOrder: 10,
  },
  {
    name: 'Ofertas',
    kind: FinanceAccountKind.income,
    sortOrder: 20,
  },
  {
    name: 'Doações online',
    kind: FinanceAccountKind.income,
    sortOrder: 30,
    systemKey: FINANCE_SYSTEM_KEYS.onlineDonations,
  },
  {
    name: 'Ingressos de eventos',
    kind: FinanceAccountKind.income,
    sortOrder: 40,
    systemKey: FINANCE_SYSTEM_KEYS.eventTickets,
  },
  {
    name: 'Outras receitas',
    kind: FinanceAccountKind.income,
    sortOrder: 90,
  },
  {
    name: 'Pessoal e sustento',
    kind: FinanceAccountKind.expense,
    sortOrder: 110,
  },
  {
    name: 'Utilidades',
    kind: FinanceAccountKind.expense,
    sortOrder: 120,
  },
  {
    name: 'Manutenção e estrutura',
    kind: FinanceAccountKind.expense,
    sortOrder: 130,
  },
  {
    name: 'Ministérios e missões',
    kind: FinanceAccountKind.expense,
    sortOrder: 140,
  },
  {
    name: 'Administração',
    kind: FinanceAccountKind.expense,
    sortOrder: 150,
  },
  {
    name: 'Outras despesas',
    kind: FinanceAccountKind.expense,
    sortOrder: 190,
  },
];
