export interface FinanceAccountResult {
  id: string;
  name: string;
  kind: 'income' | 'expense';
  systemKey: string | null;
  isActive: boolean;
  isSystem: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface FinancialPeriodResult {
  id: string;
  year: number;
  month: number;
  closedAt: string;
  closedByUserId: string | null;
  closedByUserName: string | null;
  note: string | null;
}

export interface FinancialPeriodStatusResult {
  year: number;
  month: number;
  isClosed: boolean;
  period: FinancialPeriodResult | null;
}

export interface FinancialReportAccountLine {
  accountId: string | null;
  accountName: string;
  kind: 'income' | 'expense';
  systemKey: string | null;
  /** Soma de lançamentos manuais nesta conta. */
  manualCents: number;
  /** Soma de doações online (só na conta system online_donations). */
  onlineDonationCents: number;
  /** Soma de ingressos (só na conta system event_tickets). */
  eventTicketCents: number;
  totalCents: number;
}

export interface FinancialReportResult {
  churchId: string;
  churchName: string;
  from: string;
  to: string;
  generatedAt: string;
  summary: {
    manualIncomeCents: number;
    expenseCents: number;
    onlineDonationCents: number;
    eventTicketCents: number;
    totalIncomeCents: number;
    balanceCents: number;
  };
  incomeLines: FinancialReportAccountLine[];
  expenseLines: FinancialReportAccountLine[];
  /** Períodos civis (ano-mês) tocados pelo intervalo e se estão fechados. */
  periods: FinancialPeriodStatusResult[];
}
