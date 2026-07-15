import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

import { EventRecurrenceDto } from './event-recurrence.dto';
import {
  EVENT_MUTATION_SCOPES,
  type EventMutationScope,
} from './event-mutation-scope';
import { RosterSlotPlanItemDto } from './roster-slot-plan.dto';

export class CreateChurchEventDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  ministryId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** Recado em destaque exibido na página do evento (tema da palavra, avisos pastorais). */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  highlightNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  availabilityMessage?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsDateString()
  startsAt: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => EventRecurrenceDto)
  recurrence?: EventRecurrenceDto;

  /** Este evento participa do fluxo de escala (disponibilidade e montagem). */
  @IsOptional()
  @IsBoolean()
  usesRoster?: boolean;

  /** Abre o evento para a equipe marcar disponibilidade (requer usesRoster). */
  @IsOptional()
  @IsBoolean()
  rosterOpen?: boolean;

  /** Funções necessárias neste evento (quando usesRoster). Legado: quantidade 1 por função. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  rosterRoles?: string[];

  /** Funções e quantidades necessárias (preferido em relação a rosterRoles). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RosterSlotPlanItemDto)
  rosterSlotPlan?: RosterSlotPlanItemDto[];

  /** Exibir na agenda da igreja (apenas eventos de ministério). */
  @IsOptional()
  @IsBoolean()
  visibleToChurch?: boolean;

  /** Abre inscrição para membros (gratuita se priceCents for omitido/null). */
  @IsOptional()
  @IsBoolean()
  registrationOpen?: boolean;

  /**
   * Preço da inscrição em centavos.
   * Omitir/null com registrationOpen = gratuita; ≥ 500 = paga (abre inscrição).
   */
  @IsOptional()
  @IsInt()
  @Min(500)
  @Max(10_000_000)
  priceCents?: number | null;
}

export class UpdateChurchEventDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  highlightNote?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  availabilityMessage?: string | null;

  @IsOptional()
  @IsString()
  location?: string | null;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;

  @IsOptional()
  @IsBoolean()
  usesRoster?: boolean;

  @IsOptional()
  @IsBoolean()
  rosterOpen?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  rosterRoles?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RosterSlotPlanItemDto)
  rosterSlotPlan?: RosterSlotPlanItemDto[];

  @IsOptional()
  @IsBoolean()
  visibleToChurch?: boolean;

  @IsOptional()
  @IsBoolean()
  registrationOpen?: boolean;

  @IsOptional()
  @IsInt()
  @Min(500)
  @Max(10_000_000)
  priceCents?: number | null;

  /**
   * Atualiza a regra de recorrência (estilo Google Agenda).
   * `null` remove a repetição no escopo informado.
   * Omitir deixa a série como está.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @ValidateNested()
  @Type(() => EventRecurrenceDto)
  recurrence?: EventRecurrenceDto | null;

  /** Escopo da edição em eventos recorrentes (padrão: só esta ocorrência). */
  @IsOptional()
  @IsIn(EVENT_MUTATION_SCOPES)
  scope?: EventMutationScope;
}

export class DeleteChurchEventQueryDto {
  @IsOptional()
  @IsIn(EVENT_MUTATION_SCOPES)
  scope?: EventMutationScope;
}

export class ListChurchEventsQueryDto {
  @IsOptional()
  @IsString()
  ministryId?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  churchWideOnly?: boolean;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class UpdateEventRosterCollectionDto {
  @IsBoolean()
  rosterOpen: boolean;

  @IsArray()
  @IsString({ each: true })
  eventIds: string[];
}

export class UpsertEventRosterDto {
  @IsString()
  memberId: string;

  @IsOptional()
  @IsString()
  rosterSlotId?: string;

  @IsString()
  roleLabel: string;
}
