import {
  buildUniqueChurchSlug,
  slugifyChurchName,
} from './church-slug';

describe('church-slug', () => {
  describe('slugifyChurchName', () => {
    it('normalizes accents and spaces', () => {
      expect(slugifyChurchName('Comunidade da Graça')).toBe(
        'comunidade-da-graca',
      );
      expect(slugifyChurchName('Igreja Batista Central')).toBe(
        'igreja-batista-central',
      );
    });

    it('falls back when name has no slug characters', () => {
      expect(slugifyChurchName('!!!')).toBe('igreja');
    });
  });

  describe('buildUniqueChurchSlug', () => {
    it('returns base slug for first attempt', () => {
      expect(buildUniqueChurchSlug('igreja-central', 1)).toBe('igreja-central');
    });

    it('appends numeric suffix for later attempts', () => {
      expect(buildUniqueChurchSlug('igreja-central', 3)).toBe(
        'igreja-central-3',
      );
    });
  });
});
