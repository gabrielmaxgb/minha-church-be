/** Função padrão quando a atividade da igreja não define vagas por função. */
export const CHURCH_WIDE_DEFAULT_ROSTER_ROLE = 'voluntario';

/** Função obrigatória em todo ministério (catálogo de funções de serviço). */
export const DEFAULT_MINISTRY_SERVICE_FUNCTION = CHURCH_WIDE_DEFAULT_ROSTER_ROLE;

export function isProtectedMinistryServiceFunction(label: string): boolean {
  return normalizeRosterRoleValue(label) === DEFAULT_MINISTRY_SERVICE_FUNCTION;
}

export const ROSTER_ROLE_PRESETS = [
  { id: CHURCH_WIDE_DEFAULT_ROSTER_ROLE, label: 'Voluntário' },
  { id: 'reception', label: 'Recepção' },
  { id: 'media', label: 'Mídia' },
  { id: 'children', label: 'Infantil' },
  { id: 'intercession', label: 'Intercessão' },
  { id: 'hospitality', label: 'Hospitalidade' },
  { id: 'diaconia', label: 'Diaconia' },
  { id: 'evangelism', label: 'Evangelismo' },
  { id: 'security', label: 'Segurança' },
  { id: 'coordination', label: 'Coordenação' },
  { id: 'support', label: 'Apoio geral' },
  { id: 'other', label: 'Outro' },
] as const;

export const ROSTER_ROLE_LEGACY_LABELS = [
  { id: 'vocal', label: 'Vocal' },
  { id: 'backing_vocal', label: 'Backing vocal' },
  { id: 'acoustic_guitar', label: 'Violão' },
  { id: 'electric_guitar', label: 'Guitarra' },
  { id: 'bass', label: 'Baixo' },
  { id: 'drums', label: 'Bateria' },
  { id: 'keys', label: 'Teclado' },
  { id: 'pads', label: 'Pads / loops' },
  { id: 'violin', label: 'Violino' },
  { id: 'saxophone', label: 'Saxofone' },
] as const;

function allKnownRosterRoles() {
  const seen = new Set<string>();

  return [...ROSTER_ROLE_PRESETS, ...ROSTER_ROLE_LEGACY_LABELS].filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }

    seen.add(item.id);
    return true;
  });
}

export function formatRosterRole(value: string): string {
  const preset = allKnownRosterRoles().find((item) => item.id === value);
  return preset?.label ?? value;
}

export function normalizeRosterRoleValue(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return '';
  }

  const preset = allKnownRosterRoles().find(
    (item) =>
      item.id === trimmed ||
      item.id === trimmed.toLowerCase() ||
      item.label.toLowerCase() === trimmed.toLowerCase(),
  );

  return preset?.id ?? trimmed;
}

export function needsRosterFunctions(memberFunctions: string[]): boolean {
  return (
    memberFunctions
      .map((item) => normalizeRosterRoleValue(item))
      .filter(Boolean).length === 0
  );
}

export function resolveEventProfileKey(
  recurrenceSeriesId: string | null | undefined,
  eventId: string,
): string {
  return recurrenceSeriesId ?? `single:${eventId}`;
}

export function filterRoleLabelsForEventSlots(
  slotLabels: string[],
  requested: string[],
): string[] {
  const normalized = requested
    .map((item) => normalizeRosterRoleValue(item))
    .filter(Boolean);

  const unique = [...new Set(normalized)];

  return unique.filter((role) => isAllowedMemberRosterRole(slotLabels, role));
}

export function isAllowedMemberRosterRole(
  memberFunctions: string[],
  roleLabel: string,
): boolean {
  const trimmed = roleLabel.trim();

  if (!trimmed || memberFunctions.length === 0) {
    return false;
  }

  const target = normalizeRosterRoleValue(trimmed);

  return memberFunctions.some((memberFunction) => {
    const normalizedFunction = normalizeRosterRoleValue(memberFunction);

    if (normalizedFunction === target) {
      return true;
    }

    return (
      formatRosterRole(normalizedFunction).toLowerCase() ===
      trimmed.toLowerCase()
    );
  });
}
