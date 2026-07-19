import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FinanceAccountKind,
  FinanceEntryType,
  GivingDonationStatus,
  EventTicketStatus,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import {
  CreateFinanceAccountDto,
  UpdateFinanceAccountDto,
} from './dto/finance-account.dto';
import {
  CloseFinancialPeriodDto,
  ReopenFinancialPeriodDto,
} from './dto/financial-period.dto';
import {
  DEFAULT_FINANCE_ACCOUNTS,
  FINANCE_SYSTEM_KEYS,
} from './treasury.constants';
import type {
  FinanceAccountResult,
  FinancialPeriodResult,
  FinancialPeriodStatusResult,
  FinancialReportAccountLine,
  FinancialReportResult,
} from './treasury.types';

function emptyToNull(value?: string | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function monthBounds(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { start, end };
}

function parseOccurredDate(value: string | Date): Date {
  if (value instanceof Date) {
    return value;
  }
  const dateOnly = value.slice(0, 10);
  const [y, m, d] = dateOnly.split('-').map(Number);
  if (!y || !m || !d) {
    throw new BadRequestException('Data inválida.');
  }
  return new Date(Date.UTC(y, m - 1, d));
}

function yearMonthFromDate(date: Date): { year: number; month: number } {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  };
}

function toPeriodResult(period: {
  id: string;
  year: number;
  month: number;
  closedAt: Date;
  closedByUserId: string | null;
  note: string | null;
  closedBy: { id: string; name: string } | null;
}): FinancialPeriodResult {
  return {
    id: period.id,
    year: period.year,
    month: period.month,
    closedAt: period.closedAt.toISOString(),
    closedByUserId: period.closedByUserId,
    closedByUserName: period.closedBy?.name ?? null,
    note: period.note,
  };
}

function toAccountResult(account: {
  id: string;
  name: string;
  kind: FinanceAccountKind;
  systemKey: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}): FinanceAccountResult {
  return {
    id: account.id,
    name: account.name,
    kind: account.kind,
    systemKey: account.systemKey,
    isActive: account.isActive,
    isSystem: Boolean(account.systemKey),
    sortOrder: account.sortOrder,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

@Injectable()
export class TreasuryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Garante o plano padrão + contas de sistema.
   * Idempotente — seguro chamar em listagens e antes de criar lançamento.
   */
  async ensureDefaultAccounts(churchId: string): Promise<void> {
    const existing = await this.prisma.financeAccount.findMany({
      where: { churchId },
      select: { id: true, systemKey: true, name: true },
    });

    const bySystemKey = new Map(
      existing
        .filter((a) => a.systemKey)
        .map((a) => [a.systemKey as string, a.id]),
    );
    const namesLower = new Set(existing.map((a) => a.name.trim().toLowerCase()));

    const missing = DEFAULT_FINANCE_ACCOUNTS.filter((seed) => {
      if (seed.systemKey && bySystemKey.has(seed.systemKey)) {
        return false;
      }
      if (!seed.systemKey && namesLower.has(seed.name.toLowerCase())) {
        return false;
      }
      return true;
    });

    if (missing.length === 0) {
      await this.backfillLegacyCategories(churchId);
      return;
    }

    await this.prisma.financeAccount.createMany({
      data: missing.map((seed) => ({
        churchId,
        name: seed.name,
        kind: seed.kind,
        systemKey: seed.systemKey ?? null,
        sortOrder: seed.sortOrder,
        isActive: true,
      })),
      skipDuplicates: true,
    });

    await this.backfillLegacyCategories(churchId);
  }

  /** Liga lançamentos legados (só category) a contas com o mesmo nome. */
  private async backfillLegacyCategories(churchId: string): Promise<void> {
    const orphanCount = await this.prisma.financeEntry.count({
      where: { churchId, accountId: null },
    });
    if (orphanCount === 0) return;

    const accounts = await this.prisma.financeAccount.findMany({
      where: { churchId },
      select: { id: true, name: true, kind: true },
    });
    if (accounts.length === 0) return;

    const byName = new Map(
      accounts.map((a) => [a.name.trim().toLowerCase(), a]),
    );

    const orphans = await this.prisma.financeEntry.findMany({
      where: { churchId, accountId: null },
      select: { id: true, category: true, type: true },
      take: 2000,
    });

    for (const entry of orphans) {
      const key = entry.category.trim().toLowerCase();
      let account = byName.get(key);
      if (!account) {
        const created = await this.prisma.financeAccount.create({
          data: {
            churchId,
            name: entry.category.trim().slice(0, 80) || 'Sem categoria',
            kind:
              entry.type === FinanceEntryType.income
                ? FinanceAccountKind.income
                : FinanceAccountKind.expense,
            sortOrder: 500,
            isActive: true,
          },
        });
        account = created;
        byName.set(created.name.trim().toLowerCase(), created);
      }
      await this.prisma.financeEntry.update({
        where: { id: entry.id },
        data: { accountId: account.id },
      });
    }
  }

  async listAccounts(
    churchId: string,
    options?: { kind?: string; includeInactive?: boolean },
  ): Promise<FinanceAccountResult[]> {
    await this.ensureDefaultAccounts(churchId);

    const kind =
      options?.kind === 'income' || options?.kind === 'expense'
        ? options.kind
        : undefined;

    const accounts = await this.prisma.financeAccount.findMany({
      where: {
        churchId,
        ...(kind ? { kind } : {}),
        ...(options?.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });

    return accounts.map(toAccountResult);
  }

  async createAccount(
    churchId: string,
    userId: string,
    dto: CreateFinanceAccountDto,
  ): Promise<FinanceAccountResult> {
    await this.ensureDefaultAccounts(churchId);

    const name = dto.name.trim();
    const duplicate = await this.prisma.financeAccount.findFirst({
      where: {
        churchId,
        name: { equals: name, mode: 'insensitive' },
        kind: dto.kind,
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException('Já existe uma conta com este nome.');
    }

    const maxSort = await this.prisma.financeAccount.aggregate({
      where: { churchId, kind: dto.kind },
      _max: { sortOrder: true },
    });

    const account = await this.prisma.financeAccount.create({
      data: {
        churchId,
        name,
        kind: dto.kind,
        sortOrder: dto.sortOrder ?? (maxSort._max.sortOrder ?? 0) + 10,
        createdByUserId: userId,
      },
    });

    return toAccountResult(account);
  }

  async updateAccount(
    churchId: string,
    accountId: string,
    dto: UpdateFinanceAccountDto,
  ): Promise<FinanceAccountResult> {
    const existing = await this.prisma.financeAccount.findFirst({
      where: { id: accountId, churchId },
    });
    if (!existing) {
      throw new NotFoundException('Conta não encontrada.');
    }

    if (existing.systemKey && dto.isActive === false) {
      throw new BadRequestException(
        'Contas de sistema não podem ser desativadas — elas agregam doações e ingressos nos relatórios.',
      );
    }

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      const duplicate = await this.prisma.financeAccount.findFirst({
        where: {
          churchId,
          kind: existing.kind,
          name: { equals: name, mode: 'insensitive' },
          NOT: { id: accountId },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException('Já existe uma conta com este nome.');
      }
    }

    const account = await this.prisma.financeAccount.update({
      where: { id: accountId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });

    if (dto.name !== undefined) {
      await this.prisma.financeEntry.updateMany({
        where: { churchId, accountId },
        data: { category: account.name },
      });
    }

    return toAccountResult(account);
  }

  async getPeriodStatus(
    churchId: string,
    year: number,
    month: number,
  ): Promise<FinancialPeriodStatusResult> {
    this.assertValidYearMonth(year, month);
    const period = await this.prisma.financialPeriod.findUnique({
      where: {
        churchId_year_month: { churchId, year, month },
      },
      include: { closedBy: { select: { id: true, name: true } } },
    });

    return {
      year,
      month,
      isClosed: Boolean(period),
      period: period ? toPeriodResult(period) : null,
    };
  }

  async listClosedPeriods(
    churchId: string,
    options?: { year?: number },
  ): Promise<FinancialPeriodResult[]> {
    const periods = await this.prisma.financialPeriod.findMany({
      where: {
        churchId,
        ...(options?.year ? { year: options.year } : {}),
      },
      include: { closedBy: { select: { id: true, name: true } } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      take: 36,
    });
    return periods.map(toPeriodResult);
  }

  async closePeriod(
    churchId: string,
    userId: string,
    dto: CloseFinancialPeriodDto,
  ): Promise<FinancialPeriodResult> {
    this.assertValidYearMonth(dto.year, dto.month);

    const existing = await this.prisma.financialPeriod.findUnique({
      where: {
        churchId_year_month: {
          churchId,
          year: dto.year,
          month: dto.month,
        },
      },
    });
    if (existing) {
      throw new ConflictException('Este mês já está fechado.');
    }

    const period = await this.prisma.financialPeriod.create({
      data: {
        churchId,
        year: dto.year,
        month: dto.month,
        closedAt: new Date(),
        closedByUserId: userId,
        note: emptyToNull(dto.note),
      },
      include: { closedBy: { select: { id: true, name: true } } },
    });

    return toPeriodResult(period);
  }

  async reopenPeriod(
    churchId: string,
    dto: ReopenFinancialPeriodDto,
  ): Promise<{ ok: true }> {
    this.assertValidYearMonth(dto.year, dto.month);

    const existing = await this.prisma.financialPeriod.findUnique({
      where: {
        churchId_year_month: {
          churchId,
          year: dto.year,
          month: dto.month,
        },
      },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Este mês não está fechado.');
    }

    await this.prisma.financialPeriod.delete({ where: { id: existing.id } });
    return { ok: true };
  }

  /** Bloqueia mutações de lançamentos em mês fechado. */
  async assertPeriodOpenForDate(
    churchId: string,
    occurredOn: string | Date,
  ): Promise<void> {
    const date = parseOccurredDate(occurredOn);
    const { year, month } = yearMonthFromDate(date);
    const status = await this.getPeriodStatus(churchId, year, month);
    if (status.isClosed) {
      const label = `${String(month).padStart(2, '0')}/${year}`;
      throw new ConflictException(
        `O mês ${label} está fechado. Reabra o período em Finanças para alterar lançamentos.`,
      );
    }
  }

  async resolveAccountForEntry(
    churchId: string,
    options: {
      accountId?: string;
      category?: string;
      type: FinanceEntryType;
    },
  ): Promise<{ accountId: string; category: string }> {
    await this.ensureDefaultAccounts(churchId);

    if (options.accountId) {
      const account = await this.prisma.financeAccount.findFirst({
        where: {
          id: options.accountId,
          churchId,
          isActive: true,
        },
      });
      if (!account) {
        throw new BadRequestException('Conta não encontrada ou inativa.');
      }
      const expectedKind =
        options.type === FinanceEntryType.income
          ? FinanceAccountKind.income
          : FinanceAccountKind.expense;
      if (account.kind !== expectedKind) {
        throw new BadRequestException(
          options.type === FinanceEntryType.income
            ? 'Selecione uma conta de receita para entradas.'
            : 'Selecione uma conta de despesa para saídas.',
        );
      }
      if (account.systemKey) {
        throw new BadRequestException(
          'Contas de sistema são preenchidas automaticamente (doações online e ingressos). Escolha outra conta.',
        );
      }
      return { accountId: account.id, category: account.name };
    }

    const category = options.category?.trim();
    if (!category) {
      throw new BadRequestException('Selecione uma conta do plano de contas.');
    }

    const kind =
      options.type === FinanceEntryType.income
        ? FinanceAccountKind.income
        : FinanceAccountKind.expense;

    let account = await this.prisma.financeAccount.findFirst({
      where: {
        churchId,
        kind,
        isActive: true,
        name: { equals: category, mode: 'insensitive' },
        systemKey: null,
      },
    });

    if (!account) {
      account = await this.prisma.financeAccount.create({
        data: {
          churchId,
          name: category.slice(0, 80),
          kind,
          sortOrder: 500,
          isActive: true,
        },
      });
    }

    return { accountId: account.id, category: account.name };
  }

  async getFinancialReport(
    churchId: string,
    options: { from?: string; to?: string },
  ): Promise<FinancialReportResult> {
    await this.ensureDefaultAccounts(churchId);

    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: { id: true, name: true },
    });
    if (!church) {
      throw new NotFoundException('Igreja não encontrada.');
    }

    const fromDate = options.from
      ? parseOccurredDate(options.from)
      : monthBounds(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1)
          .start;
    const toDate = options.to
      ? parseOccurredDate(options.to)
      : monthBounds(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1)
          .end;

    if (fromDate > toDate) {
      throw new BadRequestException('A data inicial deve ser anterior à final.');
    }

    const fromIso = fromDate.toISOString().slice(0, 10);
    const toIso = toDate.toISOString().slice(0, 10);

    const entryWhere: Prisma.FinanceEntryWhereInput = {
      churchId,
      occurredOn: { gte: fromDate, lte: toDate },
    };

    const donationWhere: Prisma.GivingDonationWhereInput = {
      churchId,
      status: GivingDonationStatus.succeeded,
      createdAt: {
        gte: new Date(`${fromIso}T00:00:00.000Z`),
        lte: new Date(`${toIso}T23:59:59.999Z`),
      },
    };

    const ticketWhere: Prisma.EventTicketPurchaseWhereInput = {
      churchId,
      status: EventTicketStatus.succeeded,
      createdAt: {
        gte: new Date(`${fromIso}T00:00:00.000Z`),
        lte: new Date(`${toIso}T23:59:59.999Z`),
      },
    };

    const [accounts, entries, donationAgg, ticketAgg, closedPeriods] =
      await Promise.all([
        this.prisma.financeAccount.findMany({
          where: { churchId },
          orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
        }),
        this.prisma.financeEntry.groupBy({
          by: ['accountId', 'type'],
          where: entryWhere,
          _sum: { amountCents: true },
        }),
        this.prisma.givingDonation.aggregate({
          where: donationWhere,
          _sum: { amountCents: true },
        }),
        this.prisma.eventTicketPurchase.aggregate({
          where: ticketWhere,
          _sum: { amountCents: true },
        }),
        this.prisma.financialPeriod.findMany({
          where: { churchId },
          include: { closedBy: { select: { id: true, name: true } } },
        }),
      ]);

    const onlineDonationCents = donationAgg._sum.amountCents ?? 0;
    const eventTicketCents = ticketAgg._sum.amountCents ?? 0;

    const manualByAccount = new Map<string, number>();
    let manualIncomeCents = 0;
    let expenseCents = 0;
    let uncategorizedIncome = 0;
    let uncategorizedExpense = 0;

    for (const row of entries) {
      const cents = row._sum.amountCents ?? 0;
      if (row.type === FinanceEntryType.income) {
        manualIncomeCents += cents;
      } else {
        expenseCents += cents;
      }
      if (row.accountId) {
        manualByAccount.set(
          row.accountId,
          (manualByAccount.get(row.accountId) ?? 0) + cents,
        );
      } else if (row.type === FinanceEntryType.income) {
        uncategorizedIncome += cents;
      } else {
        uncategorizedExpense += cents;
      }
    }

    const incomeLines: FinancialReportAccountLine[] = [];
    const expenseLines: FinancialReportAccountLine[] = [];

    for (const account of accounts) {
      const manual = manualByAccount.get(account.id) ?? 0;
      const isOnline =
        account.systemKey === FINANCE_SYSTEM_KEYS.onlineDonations;
      const isTickets = account.systemKey === FINANCE_SYSTEM_KEYS.eventTickets;
      const online = isOnline ? onlineDonationCents : 0;
      const tickets = isTickets ? eventTicketCents : 0;
      const total = manual + online + tickets;

      if (total === 0 && !account.systemKey) continue;

      const line: FinancialReportAccountLine = {
        accountId: account.id,
        accountName: account.name,
        kind: account.kind,
        systemKey: account.systemKey,
        manualCents: manual,
        onlineDonationCents: online,
        eventTicketCents: tickets,
        totalCents: total,
      };

      if (account.kind === FinanceAccountKind.income) {
        if (total > 0 || account.systemKey) incomeLines.push(line);
      } else if (total > 0) {
        expenseLines.push(line);
      }
    }

    if (uncategorizedIncome > 0) {
      incomeLines.push({
        accountId: null,
        accountName: 'Sem conta',
        kind: 'income',
        systemKey: null,
        manualCents: uncategorizedIncome,
        onlineDonationCents: 0,
        eventTicketCents: 0,
        totalCents: uncategorizedIncome,
      });
    }
    if (uncategorizedExpense > 0) {
      expenseLines.push({
        accountId: null,
        accountName: 'Sem conta',
        kind: 'expense',
        systemKey: null,
        manualCents: uncategorizedExpense,
        onlineDonationCents: 0,
        eventTicketCents: 0,
        totalCents: uncategorizedExpense,
      });
    }

    const totalIncomeCents =
      manualIncomeCents + onlineDonationCents + eventTicketCents;

    const periods = this.periodsTouched(fromDate, toDate).map(
      ({ year, month }) => {
        const found = closedPeriods.find(
          (p) => p.year === year && p.month === month,
        );
        return {
          year,
          month,
          isClosed: Boolean(found),
          period: found ? toPeriodResult(found) : null,
        } satisfies FinancialPeriodStatusResult;
      },
    );

    return {
      churchId: church.id,
      churchName: church.name,
      from: fromIso,
      to: toIso,
      generatedAt: new Date().toISOString(),
      summary: {
        manualIncomeCents,
        expenseCents,
        onlineDonationCents,
        eventTicketCents,
        totalIncomeCents,
        balanceCents: totalIncomeCents - expenseCents,
      },
      incomeLines,
      expenseLines,
      periods,
    };
  }

  async exportFinancialReportCsv(
    churchId: string,
    options: { from?: string; to?: string },
  ): Promise<string> {
    const report = await this.getFinancialReport(churchId, options);
    const escape = (value: string | number) => {
      const raw = String(value);
      if (/[",\n]/.test(raw)) {
        return `"${raw.replace(/"/g, '""')}"`;
      }
      return raw;
    };
    const formatBrl = (cents: number) =>
      (cents / 100).toFixed(2).replace('.', ',');

    const header = [
      'Tipo',
      'Conta',
      'Manual (R$)',
      'Online (R$)',
      'Ingressos (R$)',
      'Total (R$)',
    ];
    const rows: string[] = [];

    for (const line of report.incomeLines) {
      rows.push(
        [
          'Receita',
          line.accountName,
          formatBrl(line.manualCents),
          formatBrl(line.onlineDonationCents),
          formatBrl(line.eventTicketCents),
          formatBrl(line.totalCents),
        ]
          .map(escape)
          .join(','),
      );
    }
    for (const line of report.expenseLines) {
      rows.push(
        [
          'Despesa',
          line.accountName,
          formatBrl(line.manualCents),
          formatBrl(line.onlineDonationCents),
          formatBrl(line.eventTicketCents),
          formatBrl(line.totalCents),
        ]
          .map(escape)
          .join(','),
      );
    }

    rows.push('');
    rows.push(
      ['Total receitas', '', '', '', '', formatBrl(report.summary.totalIncomeCents)]
        .map(escape)
        .join(','),
    );
    rows.push(
      ['Total despesas', '', '', '', '', formatBrl(report.summary.expenseCents)]
        .map(escape)
        .join(','),
    );
    rows.push(
      ['Saldo', '', '', '', '', formatBrl(report.summary.balanceCents)]
        .map(escape)
        .join(','),
    );

    return `\uFEFF${header.join(',')}\n${rows.join('\n')}\n`;
  }

  private assertValidYearMonth(year: number, month: number): void {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException('Ano inválido.');
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('Mês inválido.');
    }
  }

  private periodsTouched(
    from: Date,
    to: Date,
  ): Array<{ year: number; month: number }> {
    const result: Array<{ year: number; month: number }> = [];
    let y = from.getUTCFullYear();
    let m = from.getUTCMonth() + 1;
    const endY = to.getUTCFullYear();
    const endM = to.getUTCMonth() + 1;

    while (y < endY || (y === endY && m <= endM)) {
      result.push({ year: y, month: m });
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
      if (result.length > 36) break;
    }
    return result;
  }
}
