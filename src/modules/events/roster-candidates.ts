export type RosterAvailabilityStatus = 'available' | 'unavailable' | null;

export type RosterCandidateRow = {
  memberId: string;
  memberName: string;
  availabilityStatus: RosterAvailabilityStatus;
  roleLabels: string[];
};

export type RosterAvailabilityRow = {
  memberId: string;
  status: 'available' | 'unavailable';
  roleLabels: string[];
};

/**
 * Disponibilidade é sinal, não trava: o líder pode escalar qualquer pessoa
 * do pool (ministério / igreja), inclusive quem não respondeu ou marcou
 * indisponível.
 */
export function canAssignDespiteAvailability(
  _availabilityStatus: RosterAvailabilityStatus,
): boolean {
  return true;
}

export function rankRosterAvailability(
  status: RosterAvailabilityStatus,
): number {
  if (status === 'available') {
    return 0;
  }

  if (status === null) {
    return 1;
  }

  return 2;
}

export function compareRosterCandidateRows(
  a: RosterCandidateRow,
  b: RosterCandidateRow,
): number {
  return (
    rankRosterAvailability(a.availabilityStatus) -
      rankRosterAvailability(b.availabilityStatus) ||
    a.memberName.localeCompare(b.memberName, 'pt-BR')
  );
}

/**
 * Monta candidatos a partir do time completo (ex.: todos do ministério),
 * cruzando com respostas de disponibilidade já carregadas no evento.
 * Quem já está na escala oficial é omitido.
 */
export function buildRosterCandidatesFromPool(params: {
  pool: Array<{ memberId: string; memberName: string; roleLabels: string[] }>;
  availabilities: RosterAvailabilityRow[];
  assignedMemberIds: Iterable<string>;
  /**
   * Se o membro não tem roleLabels próprias e há fallback (ex.: slots da
   * atividade da igreja / "voluntario"), usa o fallback.
   */
  fallbackRoleLabels?: string[];
}): RosterCandidateRow[] {
  const assignedIds = new Set(params.assignedMemberIds);
  const availabilityByMemberId = new Map(
    params.availabilities.map((item) => [item.memberId, item]),
  );
  const fallback = params.fallbackRoleLabels ?? [];

  return params.pool
    .filter((member) => !assignedIds.has(member.memberId))
    .map((member) => {
      const availability = availabilityByMemberId.get(member.memberId);
      const storedRoleLabels = availability?.roleLabels ?? [];
      const ownRoleLabels = member.roleLabels ?? [];

      let roleLabels: string[];

      if (ownRoleLabels.length > 0) {
        roleLabels = ownRoleLabels;
      } else if (storedRoleLabels.length > 0) {
        roleLabels = storedRoleLabels;
      } else {
        roleLabels = fallback;
      }

      return {
        memberId: member.memberId,
        memberName: member.memberName,
        availabilityStatus: availability?.status ?? null,
        roleLabels,
      };
    })
    .sort(compareRosterCandidateRows);
}
