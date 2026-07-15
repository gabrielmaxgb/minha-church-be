import {
  buildRosterCandidatesFromPool,
  canAssignDespiteAvailability,
  compareRosterCandidateRows,
  rankRosterAvailability,
} from './roster-candidates';

describe('roster-candidates', () => {
  describe('canAssignDespiteAvailability', () => {
    it('allows assign when available, unavailable, or no response', () => {
      expect(canAssignDespiteAvailability('available')).toBe(true);
      expect(canAssignDespiteAvailability('unavailable')).toBe(true);
      expect(canAssignDespiteAvailability(null)).toBe(true);
    });
  });

  describe('rankRosterAvailability', () => {
    it('ranks available first, then no response, then unavailable', () => {
      expect(rankRosterAvailability('available')).toBe(0);
      expect(rankRosterAvailability(null)).toBe(1);
      expect(rankRosterAvailability('unavailable')).toBe(2);
    });
  });

  describe('buildRosterCandidatesFromPool', () => {
    const pool = [
      { memberId: 'm1', memberName: 'Ana', roleLabels: ['voz'] },
      { memberId: 'm2', memberName: 'Bruno', roleLabels: ['guitarra'] },
      { memberId: 'm3', memberName: 'Carla', roleLabels: ['bateria'] },
      { memberId: 'm4', memberName: 'Diego', roleLabels: [] },
    ];

    it('includes the full pool, not only people who responded available', () => {
      const rows = buildRosterCandidatesFromPool({
        pool,
        availabilities: [
          { memberId: 'm1', status: 'available', roleLabels: ['voz'] },
          { memberId: 'm2', status: 'unavailable', roleLabels: ['guitarra'] },
        ],
        assignedMemberIds: [],
      });

      expect(rows.map((row) => row.memberId)).toEqual([
        'm1', // available
        'm3', // no response (null), before unavailable and after available
        'm4', // no response
        'm2', // unavailable last
      ]);
      expect(rows.find((row) => row.memberId === 'm1')?.availabilityStatus).toBe(
        'available',
      );
      expect(rows.find((row) => row.memberId === 'm2')?.availabilityStatus).toBe(
        'unavailable',
      );
      expect(rows.find((row) => row.memberId === 'm3')?.availabilityStatus).toBe(
        null,
      );
    });

    it('omits members already on the official roster', () => {
      const rows = buildRosterCandidatesFromPool({
        pool,
        availabilities: [
          { memberId: 'm1', status: 'available', roleLabels: ['voz'] },
        ],
        assignedMemberIds: ['m1', 'm3'],
      });

      expect(rows.map((row) => row.memberId)).toEqual(['m2', 'm4']);
    });

    it('uses fallback role labels when member has none (church-wide)', () => {
      const rows = buildRosterCandidatesFromPool({
        pool: [
          { memberId: 'c1', memberName: 'Eva', roleLabels: [] },
        ],
        availabilities: [],
        assignedMemberIds: [],
        fallbackRoleLabels: ['voluntario'],
      });

      expect(rows).toEqual([
        {
          memberId: 'c1',
          memberName: 'Eva',
          availabilityStatus: null,
          roleLabels: ['voluntario'],
        },
      ]);
    });

    it('prefers availability roleLabels over fallback when member has none', () => {
      const rows = buildRosterCandidatesFromPool({
        pool: [
          { memberId: 'c1', memberName: 'Eva', roleLabels: [] },
        ],
        availabilities: [
          {
            memberId: 'c1',
            status: 'available',
            roleLabels: ['recepcao'],
          },
        ],
        assignedMemberIds: [],
        fallbackRoleLabels: ['voluntario'],
      });

      expect(rows[0].roleLabels).toEqual(['recepcao']);
    });
  });

  describe('compareRosterCandidateRows', () => {
    it('sorts by availability rank then name', () => {
      const sorted = [
        {
          memberId: '2',
          memberName: 'Zoe',
          availabilityStatus: 'unavailable' as const,
          roleLabels: [],
        },
        {
          memberId: '1',
          memberName: 'Ana',
          availabilityStatus: 'available' as const,
          roleLabels: [],
        },
        {
          memberId: '3',
          memberName: 'Bia',
          availabilityStatus: null,
          roleLabels: [],
        },
      ].sort(compareRosterCandidateRows);

      expect(sorted.map((row) => row.memberName)).toEqual(['Ana', 'Bia', 'Zoe']);
    });
  });
});
