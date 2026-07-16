import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Gender, MaritalStatus, MemberStatus, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { generateTemporaryPassword } from '../../common/utils/credentials';
import { canonicalizeEmail } from '../../common/utils/canonicalize-email';
import { encryptSecret } from '../../common/utils/secret-encryption';
import {
  cpfToInternalEmail,
  formatCpf,
  isValidCpf,
  normalizeCpf,
} from '../../common/utils/cpf';
import {
  PARENTAL_CONSENT_VERSION,
  isMinorByBirthDate,
  requiresParentalConsentForAppAccess,
} from '../../common/utils/parental-consent';
import { ChurchPermissionsService } from '../../common/services/church-permissions.service';
import { EmailService } from '../../common/services/email.service';
import { SubscriptionPolicyService } from '../../common/services/subscription-policy.service';
import { PrismaService } from '../../database/prisma.service';
import { BillingService } from '../billing/billing.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { defaultMemberMinistryInstruments } from '../ministries/ministry-service-functions';
import {
  AssignMemberMinistryDto,
  AckMinistryCatalogNotificationsDto,
  CreateMemberDto,
  ImportMemberRow,
  ImportMembersDto,
  ListMembersQueryDto,
  RecordParentalConsentDto,
  UpdateMemberDto,
} from './dto/member.dto';
import {
  buildMyMinistryNotifications,
  memberNeedsServiceFunctions,
  type MyMinistryNotificationsResponse,
} from './member-ministry-notifications';
import {
  MemberWithMinistries,
  parseOptionalDate,
  toMemberResponse,
  type CreateMemberResponse,
  type ImportMembersResult,
  type MemberImportRowResult,
  type FamilyGraphResponse,
  type FamilyResponse,
  type MemberAccountCredentials,
  type MemberRelationResponse,
  type MemberRelationType,
  type MemberResponse,
  type ReceiveMemberResponse,
  type UpdateMemberResponse,
} from './members.types';

const memberInclude = {
  family: true,
  ministryLinks: {
    where: { endedAt: null },
    include: {
      ministry: true,
      roleAssignments: {
        include: {
          ministryRole: true,
        },
      },
    },
  },
} satisfies Prisma.MemberInclude;

/**
 * Include mínimo para o create: um membro recém-criado nunca tem vínculos de
 * ministério, então evitamos as queries extras de `ministryLinks`.
 */
const memberCreateInclude = { family: true } satisfies Prisma.MemberInclude;

/** Monta a resposta de um membro recém-criado (sem ministérios) evitando reler o banco. */
function toCreatedMemberResponse(
  member: Prisma.MemberGetPayload<{ include: typeof memberCreateInclude }>,
): MemberResponse {
  return toMemberResponse({
    ...member,
    ministryLinks: [],
  } as MemberWithMinistries);
}

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly billingService: BillingService,
    private readonly emailService: EmailService,
    private readonly churchPermissions: ChurchPermissionsService,
    private readonly subscriptionPolicy: SubscriptionPolicyService,
    private readonly paymentsService: PaymentsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async findAll(
    churchId: string,
    query: ListMembersQueryDto,
    userId: string,
  ): Promise<{
    data: MemberResponse[];
    meta: { total: number; page: number; limit: number };
  }> {
    const canList = await this.churchPermissions.canListChurchMembers(
      userId,
      churchId,
    );

    if (!canList) {
      throw new ForbiddenException('Permissão insuficiente.');
    }
    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: Prisma.MemberWhereInput = {
      churchId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.familyId === 'none'
        ? { familyId: null }
        : query.familyId
          ? { familyId: query.familyId }
          : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { cpf: { contains: normalizeCpf(query.search) } },
              { phone: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [members, total] = await Promise.all([
      this.prisma.member.findMany({
        where,
        include: memberInclude,
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.member.count({ where }),
    ]);

    return {
      data: members.map((member) =>
        toMemberResponse(member as MemberWithMinistries),
      ),
      meta: { total, page, limit },
    };
  }

  async findOne(churchId: string, memberId: string): Promise<MemberResponse> {
    const member = await this.getMemberOrThrow(churchId, memberId);

    return this.toMemberResponseWithGiving(churchId, member);
  }

  async findMine(userId: string, churchId: string): Promise<MemberResponse> {
    const member = await this.prisma.member.findFirst({
      where: { userId, churchId, deletedAt: null },
      include: memberInclude,
    });

    if (!member) {
      throw new NotFoundException('Cadastro pastoral não encontrado.');
    }

    return this.toMemberResponseWithGiving(
      churchId,
      member as MemberWithMinistries,
    );
  }

  async findMyMinistryNotifications(
    userId: string,
    churchId: string,
  ): Promise<MyMinistryNotificationsResponse> {
    const member = await this.prisma.member.findFirst({
      where: { userId, churchId, deletedAt: null },
      select: { id: true },
    });

    if (!member) {
      return buildMyMinistryNotifications([]);
    }

    const links = await this.prisma.memberMinistry.findMany({
      where: {
        memberId: member.id,
        endedAt: null,
        ministry: { churchId, isActive: true },
      },
      select: {
        instruments: true,
        serviceFunctionsCatalogSeenAt: true,
        ministry: {
          select: {
            id: true,
            name: true,
            serviceFunctionsUpdatedAt: true,
            serviceFunctions: { select: { id: true } },
          },
        },
      },
      orderBy: { ministry: { name: 'asc' } },
    });

    return buildMyMinistryNotifications(links);
  }

  async ackMinistryCatalogNotifications(
    userId: string,
    churchId: string,
    ministryIds: string[],
  ): Promise<MyMinistryNotificationsResponse> {
    const uniqueMinistryIds = [...new Set(ministryIds.filter(Boolean))];

    if (uniqueMinistryIds.length === 0) {
      return this.findMyMinistryNotifications(userId, churchId);
    }

    const member = await this.prisma.member.findFirst({
      where: { userId, churchId, deletedAt: null },
      select: { id: true },
    });

    if (!member) {
      throw new NotFoundException('Cadastro pastoral não encontrado.');
    }

    const ministries = await this.prisma.ministry.findMany({
      where: {
        id: { in: uniqueMinistryIds },
        churchId,
        isActive: true,
      },
      select: {
        id: true,
        serviceFunctionsUpdatedAt: true,
      },
    });

    await this.prisma.$transaction(
      ministries.map((ministry) =>
        this.prisma.memberMinistry.updateMany({
          where: {
            memberId: member.id,
            ministryId: ministry.id,
            endedAt: null,
          },
          data: {
            serviceFunctionsCatalogSeenAt: ministry.serviceFunctionsUpdatedAt,
          },
        }),
      ),
    );

    return this.findMyMinistryNotifications(userId, churchId);
  }

  async create(
    churchId: string,
    dto: CreateMemberDto,
  ): Promise<CreateMemberResponse> {
    const email = dto.email?.trim().toLowerCase() || null;
    const cpf = dto.cpf ? normalizeCpf(dto.cpf) : null;
    const status = dto.status ?? MemberStatus.visitor;
    const isActive = status === MemberStatus.active;

    if (isActive && !email && !cpf) {
      throw new BadRequestException(
        'Informe e-mail ou CPF para liberar o acesso ao sistema.',
      );
    }

    if (cpf && !isValidCpf(cpf)) {
      throw new BadRequestException('CPF inválido.');
    }

    // Cadastrar visitante/inativo é sempre liberado; receber como membro ativo
    // (que dá acesso à plataforma) é recurso premium.
    if (isActive) {
      await this.subscriptionPolicy.assertCanUseGatedFeature(churchId);
      this.assertParentalConsentForAppAccess({
        birthDate: parseOptionalDate(dto.birthDate) ?? null,
        parentalConsentAt: null,
      });
    }

    // Pré-checagens independentes rodam em paralelo (cada uma é ~1 RTT ao Neon).
    // `allSettled` preserva a ordem de prioridade das mensagens de erro.
    // Login/vínculo multi-igreja fica em syncMemberAppAccess → provisionMemberLogin
    // (mesmo caminho de update/receive) — não duplicar regra aqui.
    const settled = await Promise.allSettled([
      email ? this.ensureEmailAvailable(churchId, email) : Promise.resolve(),
      cpf ? this.ensureCpfAvailable(churchId, cpf) : Promise.resolve(),
      isActive
        ? this.assertActiveMemberTierAllowed(churchId)
        : Promise.resolve(),
      this.resolveFamilyId(churchId, dto.familyId),
    ] as const);

    for (const result of settled) {
      if (result.status === 'rejected') {
        throw result.reason;
      }
    }

    const familyId = (
      settled[3] as PromiseFulfilledResult<string | null | undefined>
    ).value;

    const visitorSince =
      parseOptionalDate(dto.visitorSince) ??
      (status === MemberStatus.visitor ? new Date() : null);
    const membershipDate =
      parseOptionalDate(dto.membershipDate) ??
      (isActive ? new Date() : null);

    const memberData = {
      churchId,
      familyId,
      name: dto.name.trim(),
      email,
      cpf,
      phone: dto.phone,
      phoneSecondary: dto.phoneSecondary,
      birthDate: parseOptionalDate(dto.birthDate),
      gender: dto.gender,
      maritalStatus: dto.maritalStatus,
      weddingAnniversary:
        dto.maritalStatus === 'married'
          ? parseOptionalDate(dto.weddingAnniversary)
          : null,
      street: dto.street,
      number: dto.number,
      complement: dto.complement,
      neighborhood: dto.neighborhood,
      city: dto.city,
      state: dto.state,
      zipCode: dto.zipCode,
      status,
      visitorSince,
      baptismDate: parseOptionalDate(dto.baptismDate),
      membershipDate,
    };

    if (!isActive) {
      const member = await this.prisma.member.create({
        data: memberData,
        include: memberCreateInclude,
      });

      // Visitante/inativo não altera a contagem de membros ativos, então
      // pulamos o recount + sync de billing.
      return toCreatedMemberResponse(member);
    }

    // Membro ativo: criar cadastro pastoral e provisionar login pelo MESMO
    // caminho de update/receive (link de conta existente ou User novo).
    // Evita regressão de regra de negócio espalhada em dois fluxos.
    const { member, account } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.member.create({
        data: memberData,
        include: memberCreateInclude,
      });

      const provisioned = await this.syncMemberAppAccess(tx, churchId, {
        id: created.id,
        name: created.name,
        email: created.email,
        cpf: created.cpf,
        userId: created.userId,
        status: created.status,
      });

      const refreshed = await tx.member.findFirstOrThrow({
        where: { id: created.id },
        include: memberCreateInclude,
      });

      return { member: refreshed, account: provisioned };
    });

    await this.syncMemberCount(churchId);

    if (account) {
      await this.emitAccountAccessNotifications(churchId, account, member.name);
    }

    return {
      ...toCreatedMemberResponse(member),
      ...(account ? { account } : {}),
    };
  }

  /**
   * Importa vários membros de uma vez (planilha).
   *
   * - `dryRun` valida sem gravar (alimenta a pré-visualização).
   * - Processa linha a linha com **sucesso parcial**: uma linha inválida vira
   *   um erro no relatório em vez de derrubar o lote.
   * - Reusa `create()` na execução real, preservando TODAS as regras (CPF/email
   *   únicos, provisionamento de login de ativo, defaults de data, limite de plano).
   * - Detecta duplicados dentro da própria planilha antes de tocar o banco.
   *
   * O cruzamento de faixa de plano (tier) é resolvido ANTES pelo cliente (uma
   * confirmação do dono); aqui cada ativo ainda passa por `create()`, que só
   * erra se o dono não tiver autorizado a faixa.
   */
  async importMembers(
    churchId: string,
    dto: ImportMembersDto,
  ): Promise<ImportMembersResult> {
    const rows = Array.isArray(dto.rows) ? dto.rows : [];
    const dryRun = dto.dryRun === true;

    const results: MemberImportRowResult[] = [];
    const seenEmail = new Map<string, number>();
    const seenCpf = new Map<string, number>();
    let created = 0;
    let errors = 0;
    let activeCount = 0;

    for (let index = 0; index < rows.length; index++) {
      const raw = rows[index] ?? {};
      const displayName = this.coerceImportString(raw.name) ?? null;

      try {
        const { dto: rowDto, email, cpf, status } =
          this.buildCreateDtoFromRow(raw);

        // Duplicados dentro da própria planilha (a linha 1 é o cabeçalho).
        if (email && seenEmail.has(email)) {
          throw new BadRequestException(
            `E-mail repetido na planilha (linha ${seenEmail.get(email)! + 2}).`,
          );
        }
        if (cpf && seenCpf.has(cpf)) {
          throw new BadRequestException(
            `CPF repetido na planilha (linha ${seenCpf.get(cpf)! + 2}).`,
          );
        }
        if (email) seenEmail.set(email, index);
        if (cpf) seenCpf.set(cpf, index);

        if (dryRun) {
          await this.validateImportRowAgainstDb(churchId, {
            email,
            cpf,
            familyId: rowDto.familyId,
          });
          results.push({ index, name: rowDto.name, outcome: 'valid', status });
        } else {
          await this.create(churchId, rowDto);
          results.push({
            index,
            name: rowDto.name,
            outcome: 'created',
            status,
          });
          created++;
        }

        if (status === MemberStatus.active) {
          activeCount++;
        }
      } catch (error) {
        results.push({
          index,
          name: displayName,
          outcome: 'error',
          status: null,
          reason: this.importErrorMessage(error),
        });
        errors++;
      }
    }

    return {
      dryRun,
      total: rows.length,
      created,
      errors,
      activeCount,
      results,
    };
  }

  /** Checagens de banco read-only para o dry-run (sem gravar). */
  private async validateImportRowAgainstDb(
    churchId: string,
    { email, cpf, familyId }: { email?: string; cpf?: string; familyId?: string },
  ): Promise<void> {
    await Promise.all([
      email ? this.ensureEmailAvailable(churchId, email) : Promise.resolve(),
      cpf ? this.ensureCpfAvailable(churchId, cpf) : Promise.resolve(),
      familyId
        ? this.resolveFamilyId(churchId, familyId)
        : Promise.resolve(undefined),
    ]);
  }

  /** Constrói um CreateMemberDto validado a partir de uma linha bruta da planilha. */
  private buildCreateDtoFromRow(raw: ImportMemberRow): {
    dto: CreateMemberDto;
    email?: string;
    cpf?: string;
    status: MemberStatus;
  } {
    const name = this.coerceImportString(raw.name);
    if (!name || name.length < 2) {
      throw new BadRequestException('Nome é obrigatório (mínimo 2 letras).');
    }

    const email = this.coerceImportString(raw.email)?.toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('E-mail inválido.');
    }

    let cpf: string | undefined;
    const rawCpf = this.coerceImportString(raw.cpf);
    if (rawCpf) {
      cpf = normalizeCpf(rawCpf);
      if (!isValidCpf(cpf)) {
        throw new BadRequestException('CPF inválido.');
      }
    }

    const status = this.normalizeImportStatus(raw.status);
    const birthDate = this.normalizeImportDate(raw.birthDate, 'Data de nascimento');

    if (status === MemberStatus.active && isMinorByBirthDate(birthDate ?? null)) {
      throw new BadRequestException(
        'Menor de idade: importe como visitante, registre o consentimento parental e depois receba como membro.',
      );
    }

    if (status === MemberStatus.active && !email && !cpf) {
      throw new BadRequestException(
        'Membro ativo precisa de e-mail ou CPF (é o login de acesso).',
      );
    }

    const maritalStatus = this.normalizeImportMaritalStatus(raw.maritalStatus);

    const dto: CreateMemberDto = {
      name,
      email,
      cpf,
      status,
      phone: this.coerceImportString(raw.phone),
      phoneSecondary: this.coerceImportString(raw.phoneSecondary),
      gender: this.normalizeImportGender(raw.gender),
      maritalStatus,
      weddingAnniversary:
        maritalStatus === MaritalStatus.married
          ? this.normalizeImportDate(raw.weddingAnniversary, 'Aniversário de casamento')
          : undefined,
      birthDate: birthDate ?? undefined,
      street: this.coerceImportString(raw.street),
      number: this.coerceImportString(raw.number),
      complement: this.coerceImportString(raw.complement),
      neighborhood: this.coerceImportString(raw.neighborhood),
      city: this.coerceImportString(raw.city),
      state: this.coerceImportString(raw.state)?.toUpperCase().slice(0, 2),
      zipCode: this.coerceImportString(raw.zipCode)?.replace(/\D/g, '') || undefined,
      visitorSince: this.normalizeImportDate(raw.visitorSince, 'Membro desde (visita)'),
      baptismDate: this.normalizeImportDate(raw.baptismDate, 'Data de batismo'),
      membershipDate: this.normalizeImportDate(raw.membershipDate, 'Data de membresia'),
      familyId: this.coerceImportString(raw.familyId),
    };

    return { dto, email, cpf, status };
  }

  private coerceImportString(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    return undefined;
  }

  /** Normaliza texto para comparação: minúsculas, sem acento. */
  private canonImportToken(value: unknown): string | undefined {
    const str = this.coerceImportString(value);
    return str
      ? str
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
      : undefined;
  }

  private normalizeImportStatus(value: unknown): MemberStatus {
    const token = this.canonImportToken(value);
    if (!token) {
      return MemberStatus.visitor;
    }
    const map: Record<string, MemberStatus> = {
      visitor: MemberStatus.visitor,
      visitante: MemberStatus.visitor,
      visita: MemberStatus.visitor,
      active: MemberStatus.active,
      ativo: MemberStatus.active,
      membro: MemberStatus.active,
      inactive: MemberStatus.inactive,
      inativo: MemberStatus.inactive,
    };
    const status = map[token];
    if (!status) {
      throw new BadRequestException(
        'Situação inválida (use visitante, ativo ou inativo).',
      );
    }
    return status;
  }

  private normalizeImportGender(value: unknown): Gender | undefined {
    const token = this.canonImportToken(value);
    if (!token) {
      return undefined;
    }
    const ignored = new Set([
      'other',
      'outro',
      'prefer_not_to_say',
      'prefiro nao dizer',
      'prefiro nao informar',
      'nao informar',
      'nao informado',
    ]);
    if (ignored.has(token)) {
      return undefined;
    }

    const map: Record<string, Gender> = {
      male: Gender.male,
      masculino: Gender.male,
      m: Gender.male,
      female: Gender.female,
      feminino: Gender.female,
      f: Gender.female,
    };
    const gender = map[token];
    if (!gender) {
      throw new BadRequestException(
        'Sexo inválido (use masculino ou feminino).',
      );
    }
    return gender;
  }

  private normalizeImportMaritalStatus(
    value: unknown,
  ): MaritalStatus | undefined {
    const token = this.canonImportToken(value);
    if (!token) {
      return undefined;
    }
    const map: Record<string, MaritalStatus> = {
      single: MaritalStatus.single,
      solteiro: MaritalStatus.single,
      solteira: MaritalStatus.single,
      married: MaritalStatus.married,
      casado: MaritalStatus.married,
      casada: MaritalStatus.married,
      divorced: MaritalStatus.divorced,
      divorciado: MaritalStatus.divorced,
      divorciada: MaritalStatus.divorced,
      widowed: MaritalStatus.widowed,
      viuvo: MaritalStatus.widowed,
      viuva: MaritalStatus.widowed,
    };
    const marital = map[token];
    if (!marital) {
      throw new BadRequestException(
        'Estado civil inválido (use solteiro, casado, divorciado ou viúvo).',
      );
    }
    return marital;
  }

  /** Aceita DD/MM/AAAA (preferido) ou AAAA-MM-DD e devolve ISO (AAAA-MM-DD). */
  private normalizeImportDate(
    value: unknown,
    label: string,
  ): string | undefined {
    const str = this.coerceImportString(value);
    if (!str) {
      return undefined;
    }

    let year: number;
    let month: number;
    let day: number;

    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
    const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str);

    if (br) {
      day = Number(br[1]);
      month = Number(br[2]);
      year = Number(br[3]);
    } else if (iso) {
      year = Number(iso[1]);
      month = Number(iso[2]);
      day = Number(iso[3]);
    } else {
      throw new BadRequestException(
        `${label} inválida (use DD/MM/AAAA, ex.: 20/05/1990).`,
      );
    }

    const date = new Date(Date.UTC(year, month - 1, day));
    const valid =
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day;
    if (!valid) {
      throw new BadRequestException(`${label} inválida.`);
    }

    const pad = (n: number) => String(n).padStart(2, '0');
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  private importErrorMessage(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === 'string') {
        return response;
      }
      if (response && typeof response === 'object' && 'message' in response) {
        const message = (response as { message: unknown }).message;
        return Array.isArray(message) ? message.join('; ') : String(message);
      }
      return error.message;
    }
    return 'Erro inesperado ao importar esta linha.';
  }

  async update(
    churchId: string,
    memberId: string,
    dto: UpdateMemberDto,
  ): Promise<UpdateMemberResponse> {
    const existing = await this.getMemberOrThrow(churchId, memberId);

    if (dto.email && dto.email !== existing.email) {
      await this.ensureEmailAvailable(churchId, dto.email, memberId);
    }

    if (dto.cpf !== undefined) {
      const normalizedCpf = dto.cpf ? normalizeCpf(dto.cpf) : null;

      if (normalizedCpf && !isValidCpf(normalizedCpf)) {
        throw new BadRequestException('CPF inválido.');
      }

      if (normalizedCpf && normalizedCpf !== existing.cpf) {
        await this.ensureCpfAvailable(churchId, normalizedCpf, memberId);
      }
    }

    const nextStatus = dto.status ?? existing.status;
    const nextEmail =
      dto.email !== undefined
        ? (dto.email?.toLowerCase() ?? null)
        : existing.email;
    const nextCpf =
      dto.cpf !== undefined
        ? dto.cpf
          ? normalizeCpf(dto.cpf)
          : null
        : existing.cpf;

    if (
      nextStatus === MemberStatus.active &&
      !existing.userId &&
      !nextEmail &&
      !nextCpf
    ) {
      throw new BadRequestException(
        'Informe e-mail ou CPF antes de ativar o acesso ao sistema.',
      );
    }

    if (
      nextStatus === MemberStatus.active &&
      existing.status !== MemberStatus.active
    ) {
      await this.subscriptionPolicy.assertCanUseGatedFeature(churchId);
      await this.assertActiveMemberTierAllowed(churchId);
      const nextBirthDate =
        dto.birthDate !== undefined
          ? (parseOptionalDate(dto.birthDate) ?? null)
          : existing.birthDate;
      this.assertParentalConsentForAppAccess({
        birthDate: nextBirthDate,
        parentalConsentAt: existing.parentalConsentAt,
      });
    }

    if (nextStatus !== MemberStatus.active && existing.userId) {
      await this.assertCanLeaveActiveStatus(churchId, existing.userId);
    }

    const maritalStatus = dto.maritalStatus ?? existing.maritalStatus;
    const previousStatus = existing.status;
    let account: MemberAccountCredentials | undefined;

    const nextFamilyId =
      dto.familyId !== undefined
        ? await this.resolveFamilyId(churchId, dto.familyId)
        : undefined;

    const member = await this.prisma.$transaction(async (tx) => {
      if (
        nextFamilyId !== undefined &&
        existing.familyId &&
        nextFamilyId !== existing.familyId
      ) {
        await tx.memberRelation.deleteMany({
          where: {
            churchId,
            OR: [{ fromMemberId: memberId }, { toMemberId: memberId }],
          },
        });
      }

      const updated = await tx.member.update({
      where: { id: memberId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.email !== undefined
          ? { email: dto.email?.toLowerCase() ?? null }
          : {}),
        ...(dto.cpf !== undefined ? { cpf: nextCpf } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.phoneSecondary !== undefined
          ? { phoneSecondary: dto.phoneSecondary }
          : {}),
        ...(dto.birthDate !== undefined
          ? { birthDate: parseOptionalDate(dto.birthDate) }
          : {}),
        ...(dto.gender !== undefined ? { gender: dto.gender } : {}),
        ...(dto.maritalStatus !== undefined
          ? { maritalStatus: dto.maritalStatus }
          : {}),
        ...(dto.weddingAnniversary !== undefined ||
        dto.maritalStatus !== undefined
          ? {
              weddingAnniversary:
                maritalStatus === 'married'
                  ? (parseOptionalDate(dto.weddingAnniversary ?? undefined) ??
                    existing.weddingAnniversary)
                  : null,
            }
          : {}),
        ...(dto.street !== undefined ? { street: dto.street } : {}),
        ...(dto.number !== undefined ? { number: dto.number } : {}),
        ...(dto.complement !== undefined ? { complement: dto.complement } : {}),
        ...(dto.neighborhood !== undefined
          ? { neighborhood: dto.neighborhood }
          : {}),
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.state !== undefined ? { state: dto.state } : {}),
        ...(dto.zipCode !== undefined ? { zipCode: dto.zipCode } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.visitorSince !== undefined
          ? { visitorSince: parseOptionalDate(dto.visitorSince) }
          : {}),
        ...(dto.baptismDate !== undefined
          ? { baptismDate: parseOptionalDate(dto.baptismDate) }
          : {}),
        ...(dto.membershipDate !== undefined
          ? { membershipDate: parseOptionalDate(dto.membershipDate) }
          : {}),
        ...(nextFamilyId !== undefined ? { familyId: nextFamilyId } : {}),
        ...(nextStatus === MemberStatus.active && previousStatus !== MemberStatus.active
          ? { membershipDate: new Date(), visitorSince: null }
          : {}),
      },
      include: memberInclude,
    });

      account = await this.syncMemberAppAccess(tx, churchId, updated);

      return tx.member.findUniqueOrThrow({
        where: { id: memberId },
        include: memberInclude,
      });
    });

    await this.syncMemberCount(churchId);

    if (account) {
      await this.emitAccountAccessNotifications(
        churchId,
        account,
        member.name,
      );
    }

    if (
      previousStatus === MemberStatus.active &&
      nextStatus !== MemberStatus.active
    ) {
      await this.paymentsService.cancelOpenGivingSubscriptionsForMember(
        churchId,
        memberId,
      );
    }

    return {
      ...(await this.toMemberResponseWithGiving(churchId, member)),
      ...(account ? { account } : {}),
    };
  }

  async remove(churchId: string, memberId: string): Promise<void> {
    await this.getMemberOrThrow(churchId, memberId);

    await this.prisma.member.update({
      where: { id: memberId },
      data: { deletedAt: new Date() },
    });

    // Após soft-delete: ainda vinculados por donorMemberId — cancela cobranças futuras.
    await this.paymentsService.cancelOpenGivingSubscriptionsForMember(
      churchId,
      memberId,
    );

    await this.syncMemberCount(churchId);
  }

  async receive(
    churchId: string,
    memberId: string,
  ): Promise<ReceiveMemberResponse> {
    const member = await this.getMemberOrThrow(churchId, memberId);

    if (member.status === MemberStatus.active) {
      throw new ConflictException('Membro já foi recebido.');
    }

    if (!member.email && !member.cpf) {
      throw new BadRequestException(
        'Cadastre e-mail ou CPF antes de receber como membro.',
      );
    }

    await this.subscriptionPolicy.assertCanUseGatedFeature(churchId);
    await this.assertActiveMemberTierAllowed(churchId);
    this.assertParentalConsentForAppAccess(member);

    let account: MemberAccountCredentials | undefined;

    const updated = await this.prisma.$transaction(async (tx) => {
      const received = await tx.member.update({
        where: { id: memberId },
        data: {
          status: MemberStatus.active,
          membershipDate: new Date(),
          visitorSince: null,
        },
        include: memberInclude,
      });

      account = await this.syncMemberAppAccess(tx, churchId, received);

      return tx.member.findUniqueOrThrow({
        where: { id: memberId },
        include: memberInclude,
      });
    });

    await this.syncMemberCount(churchId);

    if (account) {
      await this.emitAccountAccessNotifications(
        churchId,
        account,
        updated.name,
      );
    }

    return {
      ...toMemberResponse(updated),
      ...(account ? { account } : {}),
    };
  }

  async recordParentalConsent(
    churchId: string,
    memberId: string,
    userId: string,
    dto: RecordParentalConsentDto,
  ): Promise<MemberResponse> {
    if (dto.accepted !== true) {
      throw new BadRequestException(
        'É necessário aceitar o consentimento parental para continuar.',
      );
    }

    const member = await this.getMemberOrThrow(churchId, memberId);

    if (!isMinorByBirthDate(member.birthDate)) {
      throw new BadRequestException(
        'Consentimento parental só se aplica a menores de 18 anos com data de nascimento cadastrada.',
      );
    }

    const guardianMemberId = dto.guardianMemberId?.trim() || null;
    let guardianName = dto.guardianName?.trim() || null;
    let guardianEmail = dto.guardianEmail?.trim().toLowerCase() || null;

    if (guardianMemberId) {
      const guardian = await this.getMemberOrThrow(churchId, guardianMemberId);

      if (guardian.id === member.id) {
        throw new BadRequestException(
          'O responsável não pode ser o próprio menor.',
        );
      }

      guardianName = guardian.name;
      guardianEmail = guardian.email ?? guardianEmail;
    }

    if (!guardianName || guardianName.length < 2) {
      throw new BadRequestException(
        'Informe o responsável (membro da família ou nome).',
      );
    }

    const updated = await this.prisma.member.update({
      where: { id: memberId },
      data: {
        parentalConsentAt: new Date(),
        parentalConsentByUserId: userId,
        parentalConsentGuardianMemberId: guardianMemberId,
        parentalConsentGuardianName: guardianName,
        parentalConsentGuardianEmail: guardianEmail,
        parentalConsentVersion: PARENTAL_CONSENT_VERSION,
      },
      include: memberInclude,
    });

    return toMemberResponse(updated);
  }

  async revokeParentalConsent(
    churchId: string,
    memberId: string,
  ): Promise<MemberResponse> {
    const member = await this.getMemberOrThrow(churchId, memberId);

    if (!member.parentalConsentAt) {
      throw new BadRequestException(
        'Não há consentimento parental registrado para este cadastro.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      let next = await tx.member.update({
        where: { id: memberId },
        data: {
          parentalConsentAt: null,
          parentalConsentByUserId: null,
          parentalConsentGuardianMemberId: null,
          parentalConsentGuardianName: null,
          parentalConsentGuardianEmail: null,
          parentalConsentVersion: null,
          ...(member.status === MemberStatus.active &&
          isMinorByBirthDate(member.birthDate)
            ? { status: MemberStatus.inactive }
            : {}),
        },
        include: memberInclude,
      });

      if (
        member.status === MemberStatus.active &&
        isMinorByBirthDate(member.birthDate)
      ) {
        await this.syncMemberAppAccess(tx, churchId, next);
        next = await tx.member.findUniqueOrThrow({
          where: { id: memberId },
          include: memberInclude,
        });
      }

      return next;
    });

    await this.syncMemberCount(churchId);

    return toMemberResponse(updated);
  }

  private assertParentalConsentForAppAccess(member: {
    birthDate: Date | string | null | undefined;
    parentalConsentAt: Date | string | null | undefined;
  }): void {
    if (requiresParentalConsentForAppAccess(member)) {
      throw new BadRequestException(
        'Menor de idade: registre o consentimento parental antes de liberar o acesso ao painel.',
      );
    }
  }

  async assignMinistry(
    churchId: string,
    memberId: string,
    userId: string,
    dto: AssignMemberMinistryDto,
  ): Promise<MemberResponse> {
    await this.assertCanManageMinistryTeam(userId, churchId, dto.ministryId);
    await this.getMemberOrThrow(churchId, memberId);
    await this.ensureMinistryBelongsToChurch(churchId, dto.ministryId);

    const uniqueRoleIds =
      dto.ministryRoleIds !== undefined
        ? [...new Set(dto.ministryRoleIds)]
        : undefined;

    if (uniqueRoleIds) {
      const roles = await this.prisma.ministryRole.findMany({
        where: { ministryId: dto.ministryId, id: { in: uniqueRoleIds } },
        select: {
          id: true,
          name: true,
          singleHolder: true,
        },
      });

      if (roles.length !== uniqueRoleIds.length) {
        throw new NotFoundException('Cargo do ministério não encontrado.');
      }
    }

    const catalog = await this.prisma.ministryServiceFunction.findMany({
      where: { ministryId: dto.ministryId },
      select: { label: true },
    });
    const defaultInstruments = defaultMemberMinistryInstruments(
      catalog.map((item) => item.label),
    );

    await this.prisma.$transaction(async (tx) => {
      const link = await tx.memberMinistry.upsert({
        where: {
          memberId_ministryId: {
            memberId,
            ministryId: dto.ministryId,
          },
        },
        update: {
          startedAt: parseOptionalDate(dto.startedAt) ?? new Date(),
          endedAt: null,
        },
        create: {
          memberId,
          ministryId: dto.ministryId,
          startedAt: parseOptionalDate(dto.startedAt) ?? new Date(),
          instruments: defaultInstruments,
        },
      });

      if (link.instruments.length === 0) {
        await tx.memberMinistry.update({
          where: { id: link.id },
          data: { instruments: defaultInstruments },
        });
      }

      if (uniqueRoleIds !== undefined) {
        const singleHolderRoles = await tx.ministryRole.findMany({
          where: {
            id: { in: uniqueRoleIds },
            singleHolder: true,
          },
          select: { id: true },
        });

        for (const role of singleHolderRoles) {
          await tx.memberMinistryRole.deleteMany({
            where: {
              ministryRoleId: role.id,
              memberMinistryId: { not: link.id },
              memberMinistry: {
                ministryId: dto.ministryId,
                endedAt: null,
              },
            },
          });
        }

        await tx.memberMinistryRole.deleteMany({
          where: { memberMinistryId: link.id },
        });

        if (uniqueRoleIds.length > 0) {
          await tx.memberMinistryRole.createMany({
            data: uniqueRoleIds.map((ministryRoleId) => ({
              memberMinistryId: link.id,
              ministryRoleId,
            })),
          });
        }
      }
    });

    const member = await this.getMemberOrThrow(churchId, memberId);

    return toMemberResponse(member);
  }

  async removeMinistry(
    churchId: string,
    memberId: string,
    ministryId: string,
    userId: string,
  ): Promise<MemberResponse> {
    await this.assertCanManageMinistryTeam(userId, churchId, ministryId);
    await this.getMemberOrThrow(churchId, memberId);

    const link = await this.prisma.memberMinistry.findUnique({
      where: {
        memberId_ministryId: {
          memberId,
          ministryId,
        },
      },
    });

    if (!link) {
      throw new NotFoundException('Vínculo com ministério não encontrado.');
    }

    await this.prisma.memberMinistry.update({
      where: { id: link.id },
      data: { endedAt: new Date() },
    });

    const member = await this.getMemberOrThrow(churchId, memberId);

    return toMemberResponse(member);
  }

  private async assertCanManageMinistryTeam(
    userId: string,
    churchId: string,
    ministryId: string,
  ) {
    const allowed = await this.churchPermissions.canManageMinistryTeam(
      userId,
      churchId,
      ministryId,
    );

    if (!allowed) {
      throw new ForbiddenException(
        'Sem permissão para gerenciar a equipe deste ministério.',
      );
    }
  }

  private async toMemberResponseWithGiving(
    churchId: string,
    member: MemberWithMinistries,
  ): Promise<MemberResponse> {
    const activeGivingSubscriptionsCount =
      await this.paymentsService.countOpenGivingSubscriptionsForMember(
        churchId,
        member.id,
      );

    return {
      ...toMemberResponse(member),
      activeGivingSubscriptionsCount,
    };
  }

  private async getMemberOrThrow(
    churchId: string,
    memberId: string,
  ): Promise<MemberWithMinistries> {
    const member = await this.prisma.member.findFirst({
      where: { id: memberId, churchId, deletedAt: null },
      include: memberInclude,
    });

    if (!member) {
      throw new NotFoundException('Membro não encontrado.');
    }

    return member;
  }

  private async ensureEmailAvailable(
    churchId: string,
    email: string,
    excludeMemberId?: string,
  ) {
    const existing = await this.prisma.member.findFirst({
      where: {
        churchId,
        email: email.toLowerCase(),
        deletedAt: null,
        ...(excludeMemberId ? { NOT: { id: excludeMemberId } } : {}),
      },
    });

    if (existing) {
      throw new ConflictException('E-mail já cadastrado nesta igreja.');
    }
  }

  private async ensureCpfAvailable(
    churchId: string,
    cpf: string,
    excludeMemberId?: string,
  ) {
    const existing = await this.prisma.member.findFirst({
      where: {
        churchId,
        cpf,
        deletedAt: null,
        ...(excludeMemberId ? { NOT: { id: excludeMemberId } } : {}),
      },
    });

    if (existing) {
      throw new ConflictException('CPF já cadastrado nesta igreja.');
    }
  }

  private async ensureUserCredentialsAvailable(
    email: string | null,
    cpf: string | null,
  ) {
    if (email) {
      const existingUser = await this.prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        throw new ConflictException('E-mail já possui login no sistema.');
      }
    }

    if (cpf) {
      const existingUser = await this.prisma.user.findUnique({
        where: { cpf },
      });

      if (existingUser) {
        throw new ConflictException('CPF já possui login no sistema.');
      }
    }
  }

  private async ensureMinistryBelongsToChurch(
    churchId: string,
    ministryId: string,
  ) {
    const ministry = await this.prisma.ministry.findFirst({
      where: { id: ministryId, churchId, isActive: true },
    });

    if (!ministry) {
      throw new NotFoundException('Ministério não encontrado.');
    }
  }

  private async ensureRoleBelongsToMinistry(
    ministryId: string,
    ministryRoleId: string,
  ) {
    const role = await this.prisma.ministryRole.findFirst({
      where: { id: ministryRoleId, ministryId },
    });

    if (!role) {
      throw new NotFoundException('Cargo do ministério não encontrado.');
    }
  }

  private async provisionMemberLogin(
    tx: Prisma.TransactionClient,
    churchId: string,
    member: {
      id: string;
      name: string;
      email: string | null;
      cpf: string | null;
      userId: string | null;
    },
  ): Promise<MemberAccountCredentials> {
    const email = member.email?.trim().toLowerCase() || null;
    const cpf = member.cpf;

    if (!email && !cpf) {
      throw new BadRequestException(
        'Informe e-mail ou CPF para liberar o acesso ao sistema.',
      );
    }

    if (member.userId) {
      const existingMembership = await tx.churchMembership.findUnique({
        where: {
          userId_churchId: {
            userId: member.userId,
            churchId,
          },
        },
      });

      if (existingMembership) {
        throw new ConflictException('Membro já possui acesso ao sistema.');
      }
    }

    const existingUser = await this.findExistingUserForLogin(tx, email, cpf);

    if (existingUser) {
      return this.linkExistingUserLogin(tx, churchId, member.id, existingUser, {
        email,
        cpf,
      });
    }

    await this.ensureUserCredentialsAvailable(email, cpf);

    const userEmail = email ?? cpfToInternalEmail(cpf!);
    const loginIdentifier = email ?? formatCpf(cpf!);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const temporaryPasswordEnc = encryptSecret(
      temporaryPassword,
      this.config.get<string>('jwt.secret') ?? '',
    );

    const memberRole = await tx.churchRole.findFirst({
      where: { churchId, systemKey: 'member' },
    });

    const user = await tx.user.create({
      data: {
        email: userEmail,
        emailCanonical: canonicalizeEmail(userEmail),
        cpf,
        name: member.name,
        passwordHash,
        mustChangePassword: true,
        temporaryPasswordEnc,
        emailVerifiedAt: new Date(),
      },
    });

    await tx.churchMembership.create({
      data: {
        userId: user.id,
        churchId,
        isOwner: false,
        ...(memberRole
          ? {
              roleAssignments: {
                create: [{ roleId: memberRole.id }],
              },
            }
          : {}),
      },
    });

    await tx.member.update({
      where: { id: member.id },
      data: { userId: user.id },
    });

    return {
      kind: 'created',
      login: loginIdentifier,
      temporaryPassword,
      mustChangePassword: true,
      userId: user.id,
    };
  }

  private async findExistingUserForLogin(
    tx: Prisma.TransactionClient | PrismaService,
    email: string | null,
    cpf: string | null,
  ): Promise<{
    id: string;
    email: string;
    cpf: string | null;
    name: string;
  } | null> {
    if (email) {
      const userByEmail = await tx.user.findUnique({
        where: { email },
        select: { id: true, email: true, cpf: true, name: true },
      });

      if (!userByEmail) {
        if (cpf) {
          const userByCpf = await tx.user.findUnique({
            where: { cpf },
            select: { id: true, email: true, cpf: true, name: true },
          });

          if (userByCpf) {
            this.assertLoginIdentityConsistent(userByCpf, email, cpf);
            return userByCpf;
          }
        }

        return null;
      }

      this.assertLoginIdentityConsistent(userByEmail, email, cpf);

      if (cpf) {
        const userByCpf = await tx.user.findUnique({
          where: { cpf },
          select: { id: true },
        });

        if (userByCpf && userByCpf.id !== userByEmail.id) {
          throw new ConflictException(
            'E-mail e CPF pertencem a contas diferentes no sistema.',
          );
        }
      }

      return userByEmail;
    }

    if (cpf) {
      const userByCpf = await tx.user.findUnique({
        where: { cpf },
        select: { id: true, email: true, cpf: true, name: true },
      });

      if (!userByCpf) {
        return null;
      }

      this.assertLoginIdentityConsistent(userByCpf, email, cpf);
      return userByCpf;
    }

    return null;
  }

  private assertLoginIdentityConsistent(
    user: { email: string; cpf: string | null },
    memberEmail: string | null,
    memberCpf: string | null,
  ): void {
    if (
      memberCpf &&
      user.cpf &&
      normalizeCpf(memberCpf) !== normalizeCpf(user.cpf)
    ) {
      throw new ConflictException(
        'O CPF informado não corresponde à conta existente com este e-mail.',
      );
    }

    if (
      memberEmail &&
      user.email &&
      !this.isCpfInternalEmail(user.email) &&
      user.email.trim().toLowerCase() !== memberEmail
    ) {
      throw new ConflictException(
        'O e-mail informado não corresponde à conta existente com este CPF.',
      );
    }
  }

  private isCpfInternalEmail(email: string): boolean {
    return email.endsWith('@accounts.minhachurch.app');
  }

  private async linkExistingUserLogin(
    tx: Prisma.TransactionClient,
    churchId: string,
    memberId: string,
    user: { id: string; email: string; cpf: string | null },
    identifiers: { email: string | null; cpf: string | null },
  ): Promise<MemberAccountCredentials> {
    const existingMembership = await tx.churchMembership.findUnique({
      where: {
        userId_churchId: {
          userId: user.id,
          churchId,
        },
      },
    });

    if (existingMembership) {
      throw new ConflictException(
        'Esta conta já possui acesso a esta igreja.',
      );
    }

    const linkedMember = await tx.member.findFirst({
      where: {
        churchId,
        userId: user.id,
        deletedAt: null,
        NOT: { id: memberId },
      },
      select: { id: true },
    });

    if (linkedMember) {
      throw new ConflictException(
        'Já existe um cadastro nesta igreja vinculado a esta conta.',
      );
    }

    const memberRole = await tx.churchRole.findFirst({
      where: { churchId, systemKey: 'member' },
    });

    await tx.churchMembership.create({
      data: {
        userId: user.id,
        churchId,
        isOwner: false,
        ...(memberRole
          ? {
              roleAssignments: {
                create: [{ roleId: memberRole.id }],
              },
            }
          : {}),
      },
    });

    await tx.member.update({
      where: { id: memberId },
      data: { userId: user.id },
    });

    const login =
      identifiers.email ??
      (identifiers.cpf ? formatCpf(identifiers.cpf) : user.email);

    return {
      kind: 'linked',
      login,
      linkedExistingAccount: true,
      userId: user.id,
    };
  }

  private async emitAccountAccessNotifications(
    churchId: string,
    account: MemberAccountCredentials,
    memberName: string,
  ): Promise<void> {
    if (account.kind === 'linked') {
      await this.notifyExistingUserLinkedToChurch(
        churchId,
        account.login,
        account.userId,
      );
      return;
    }

    this.notificationsService.schedule(
      this.notificationsService.emitPendingAccess({
        churchId,
        pendingUserId: account.userId,
        pendingUserName: memberName,
      }),
      'pending_access',
    );
  }

  private async notifyExistingUserLinkedToChurch(
    churchId: string,
    login: string,
    userId: string,
  ): Promise<void> {
    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: { name: true },
    });

    if (!church) {
      return;
    }

    this.notificationsService.schedule(
      this.notificationsService.emitAccountLinked({
        churchId,
        userId,
        churchName: church.name,
      }),
      'account_linked',
    );

    const email = login.includes('@') ? login.trim().toLowerCase() : null;

    if (!email || this.isCpfInternalEmail(email)) {
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });

    if (!user) {
      return;
    }

    const appUrl = this.config.get<string>('appUrl') ?? 'http://localhost:3000';

    try {
      await this.emailService.sendMemberAccountLinkedEmail(user.email, {
        userName: user.name,
        churchName: church.name,
        login: user.email,
        appUrl,
      });
    } catch (error) {
      this.logger.warn(
        `Falha ao enviar e-mail de vínculo de conta (${churchId}): ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
    }
  }

  /**
   * Fonte da verdade: Member.status === active ⇔ ChurchMembership + cargo `member`.
   * Owner nunca perde membership por mudança de status pastoral.
   */
  private async syncMemberAppAccess(
    tx: Prisma.TransactionClient,
    churchId: string,
    member: {
      id: string;
      name: string;
      email: string | null;
      cpf: string | null;
      userId: string | null;
      status: MemberStatus;
    },
  ): Promise<MemberAccountCredentials | undefined> {
    if (member.status === MemberStatus.active) {
      if (!member.userId) {
        return this.provisionMemberLogin(tx, churchId, member);
      }

      await this.ensureMembershipWithMemberRole(tx, churchId, member.userId);

      return undefined;
    }

    if (!member.userId) {
      return undefined;
    }

    await this.revokeMemberLogin(tx, churchId, member.id, member.userId);

    return undefined;
  }

  private async assertCanLeaveActiveStatus(
    churchId: string,
    userId: string,
  ): Promise<void> {
    const membership = await this.prisma.churchMembership.findUnique({
      where: {
        userId_churchId: {
          userId,
          churchId,
        },
      },
      select: { isOwner: true },
    });

    if (membership?.isOwner) {
      throw new BadRequestException(
        'Não é possível alterar o status pastoral do proprietário para visitante ou inativo.',
      );
    }
  }

  async ensureMembershipWithMemberRole(
    tx: Prisma.TransactionClient | PrismaService,
    churchId: string,
    userId: string,
  ): Promise<void> {
    const memberRole = await tx.churchRole.findFirst({
      where: { churchId, systemKey: 'member' },
      select: { id: true },
    });

    const membership = await tx.churchMembership.findUnique({
      where: {
        userId_churchId: {
          userId,
          churchId,
        },
      },
      select: { id: true },
    });

    if (!membership) {
      await tx.churchMembership.create({
        data: {
          userId,
          churchId,
          isOwner: false,
          ...(memberRole
            ? {
                roleAssignments: {
                  create: [{ roleId: memberRole.id }],
                },
              }
            : {}),
        },
      });

      return;
    }

    if (!memberRole) {
      return;
    }

    await tx.churchMembershipRole.createMany({
      data: [
        {
          membershipId: membership.id,
          roleId: memberRole.id,
        },
      ],
      skipDuplicates: true,
    });
  }

  private async revokeMemberLogin(
    tx: Prisma.TransactionClient,
    churchId: string,
    memberId: string,
    userId: string,
  ): Promise<void> {
    const membership = await tx.churchMembership.findUnique({
      where: {
        userId_churchId: {
          userId,
          churchId,
        },
      },
      include: {
        roleAssignments: {
          include: { role: true },
        },
      },
    });

    if (!membership) {
      await tx.member.update({
        where: { id: memberId },
        data: { userId: null },
      });

      return;
    }

    if (membership.isOwner) {
      throw new BadRequestException(
        'Não é possível remover o acesso de um proprietário por aqui.',
      );
    }

    const hasNonMemberRole = membership.roleAssignments.some(
      (assignment) =>
        assignment.role.systemKey && assignment.role.systemKey !== 'member',
    );

    if (hasNonMemberRole) {
      throw new BadRequestException(
        'Este usuário possui cargos administrativos. Ajuste o acesso em Configurações.',
      );
    }

    await tx.churchMembershipRole.deleteMany({
      where: { membershipId: membership.id },
    });

    await tx.churchMembership.delete({
      where: { id: membership.id },
    });

    await tx.member.update({
      where: { id: memberId },
      data: { userId: null },
    });
  }

  private async assertActiveMemberTierAllowed(churchId: string): Promise<void> {
    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: {
        memberCount: true,
        subscriptionStatus: true,
        stripeSubscriptionId: true,
        stripePriceId: true,
      },
    });

    if (!church) {
      throw new NotFoundException('Igreja não encontrada.');
    }

    await this.billingService.assertActiveMemberIncreaseAllowed(
      churchId,
      church.memberCount + 1,
      church,
    );
  }

  private async syncMemberCount(churchId: string) {
    const count = await this.prisma.member.count({
      where: {
        churchId,
        deletedAt: null,
        status: MemberStatus.active,
      },
    });

    await this.prisma.church.update({
      where: { id: churchId },
      data: { memberCount: count },
    });

    await this.billingService.syncSubscriptionTierForMemberCount(churchId);
  }

  /**
   * Garante cadastro pastoral (tabela members) para quem tem acesso à igreja.
   * Acesso (church_memberships) e lista de Membros são registros separados.
   */
  async ensurePastoralRecordForUser(
    churchId: string,
    userId: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return;
    }

    const email = user.email.trim().toLowerCase();

    const existing = await this.prisma.member.findFirst({
      where: {
        churchId,
        deletedAt: null,
        OR: [{ userId }, { email }],
      },
    });

    if (existing) {
      if (
        existing.userId !== userId ||
        existing.name !== user.name ||
        existing.status !== MemberStatus.active
      ) {
        await this.prisma.member.update({
          where: { id: existing.id },
          data: {
            userId,
            name: user.name,
            status: MemberStatus.active,
            membershipDate: existing.membershipDate ?? new Date(),
            deletedAt: null,
          },
        });
      }
    } else {
      await this.prisma.member.create({
        data: {
          churchId,
          userId,
          name: user.name,
          email,
          status: MemberStatus.active,
          membershipDate: new Date(),
        },
      });

      await this.syncMemberCount(churchId);
    }

    await this.ensureMembershipWithMemberRole(this.prisma, churchId, userId);
  }

  async listFamilies(
    churchId: string,
    userId: string,
  ): Promise<FamilyResponse[]> {
    const canList = await this.churchPermissions.canListChurchMembers(
      userId,
      churchId,
    );

    if (!canList) {
      throw new ForbiddenException('Permissão insuficiente.');
    }

    const families = await this.prisma.family.findMany({
      where: { churchId },
      include: {
        _count: {
          select: {
            members: { where: { deletedAt: null } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return families.map((family) => ({
      id: family.id,
      churchId: family.churchId,
      name: family.name,
      memberCount: family._count.members,
      createdAt: family.createdAt.toISOString(),
      updatedAt: family.updatedAt.toISOString(),
    }));
  }

  async createFamily(
    churchId: string,
    name: string,
  ): Promise<FamilyResponse> {
    const trimmed = name.trim();

    if (trimmed.length < 2) {
      throw new BadRequestException('Informe um nome de família com pelo menos 2 caracteres.');
    }

    try {
      const family = await this.prisma.family.create({
        data: {
          churchId,
          name: trimmed,
        },
      });

      return {
        id: family.id,
        churchId: family.churchId,
        name: family.name,
        memberCount: 0,
        createdAt: family.createdAt.toISOString(),
        updatedAt: family.updatedAt.toISOString(),
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Já existe uma família com esse nome.');
      }

      throw error;
    }
  }

  private async resolveFamilyId(
    churchId: string,
    familyId?: string | null,
  ): Promise<string | null | undefined> {
    if (familyId === undefined) {
      return undefined;
    }

    if (familyId === null || familyId === '') {
      return null;
    }

    const family = await this.prisma.family.findFirst({
      where: { id: familyId, churchId },
      select: { id: true },
    });

    if (!family) {
      throw new BadRequestException('Família não encontrada nesta igreja.');
    }

    return family.id;
  }

  async getFamilyGraph(
    churchId: string,
    familyId: string,
    userId: string,
  ): Promise<FamilyGraphResponse> {
    const canList = await this.churchPermissions.canListChurchMembers(
      userId,
      churchId,
    );

    if (!canList) {
      throw new ForbiddenException('Permissão insuficiente.');
    }

    const family = await this.prisma.family.findFirst({
      where: { id: familyId, churchId },
    });

    if (!family) {
      throw new NotFoundException('Família não encontrada.');
    }

    const members = await this.prisma.member.findMany({
      where: { churchId, familyId, deletedAt: null },
      select: { id: true, name: true, status: true },
      orderBy: { name: 'asc' },
    });

    const memberIds = members.map((member) => member.id);

    const relations =
      memberIds.length === 0
        ? []
        : await this.prisma.memberRelation.findMany({
            where: {
              churchId,
              fromMemberId: { in: memberIds },
              toMemberId: { in: memberIds },
            },
            orderBy: { createdAt: 'asc' },
          });

    return {
      family: { id: family.id, name: family.name },
      members,
      relations: relations.map((relation) => ({
        id: relation.id,
        fromMemberId: relation.fromMemberId,
        toMemberId: relation.toMemberId,
        type: relation.type,
        createdAt: relation.createdAt.toISOString(),
      })),
    };
  }

  async createMemberRelation(
    churchId: string,
    familyId: string,
    dto: {
      fromMemberId: string;
      toMemberId: string;
      type: MemberRelationType;
    },
  ): Promise<MemberRelationResponse> {
    if (dto.fromMemberId === dto.toMemberId) {
      throw new BadRequestException('Escolha duas pessoas diferentes.');
    }

    const family = await this.prisma.family.findFirst({
      where: { id: familyId, churchId },
      select: { id: true },
    });

    if (!family) {
      throw new NotFoundException('Família não encontrada.');
    }

    const members = await this.prisma.member.findMany({
      where: {
        churchId,
        familyId,
        deletedAt: null,
        id: { in: [dto.fromMemberId, dto.toMemberId] },
      },
      select: { id: true },
    });

    if (members.length !== 2) {
      throw new BadRequestException(
        'As duas pessoas precisam pertencer a esta família.',
      );
    }

    let fromMemberId = dto.fromMemberId;
    let toMemberId = dto.toMemberId;

    // Undirected bonds: store a canonical edge and block the reverse duplicate.
    const undirected =
      dto.type === 'spouse' || dto.type === 'sibling';

    if (undirected) {
      const ordered = [dto.fromMemberId, dto.toMemberId].sort();
      fromMemberId = ordered[0];
      toMemberId = ordered[1];

      const existing = await this.prisma.memberRelation.findFirst({
        where: {
          churchId,
          type: dto.type,
          OR: [
            { fromMemberId, toMemberId },
            { fromMemberId: toMemberId, toMemberId: fromMemberId },
          ],
        },
      });

      if (existing) {
        throw new ConflictException(
          dto.type === 'spouse'
            ? 'Essas pessoas já estão como cônjuges.'
            : 'Essas pessoas já estão como irmãos(ãs).',
        );
      }
    }

    try {
      const relation = await this.prisma.memberRelation.create({
        data: {
          churchId,
          fromMemberId,
          toMemberId,
          type: dto.type,
        },
      });

      return {
        id: relation.id,
        fromMemberId: relation.fromMemberId,
        toMemberId: relation.toMemberId,
        type: relation.type,
        createdAt: relation.createdAt.toISOString(),
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Esse vínculo já existe.');
      }

      throw error;
    }
  }

  async deleteMemberRelation(
    churchId: string,
    familyId: string,
    relationId: string,
  ): Promise<void> {
    const relation = await this.prisma.memberRelation.findFirst({
      where: { id: relationId, churchId },
      include: {
        fromMember: { select: { familyId: true } },
        toMember: { select: { familyId: true } },
      },
    });

    if (
      !relation ||
      relation.fromMember.familyId !== familyId ||
      relation.toMember.familyId !== familyId
    ) {
      throw new NotFoundException('Vínculo não encontrado nesta família.');
    }

    await this.prisma.memberRelation.delete({ where: { id: relationId } });
  }
}
