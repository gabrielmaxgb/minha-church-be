import {
  canonicalizeEmail,
  resolveEmailCanonical,
} from './canonical-email';

describe('canonical-email', () => {
  describe('canonicalizeEmail', () => {
    it('normalizes Gmail aliases and dots', () => {
      expect(canonicalizeEmail('gmaxgomes+1@gmail.com')).toBe(
        'gmaxgomes@gmail.com',
      );
      expect(canonicalizeEmail('g.max.gomes@gmail.com')).toBe(
        'gmaxgomes@gmail.com',
      );
    });

    it('normalizes Outlook aliases', () => {
      expect(canonicalizeEmail('user+tag@outlook.com')).toBe(
        'user@outlook.com',
      );
    });

    it('strips plus tags for generic domains', () => {
      expect(canonicalizeEmail('owner+igreja@igreja.com.br')).toBe(
        'owner@igreja.com.br',
      );
    });
  });

  describe('resolveEmailCanonical', () => {
    it('keeps literal email when canonical enforcement is disabled', () => {
      expect(resolveEmailCanonical('gmaxgomes+1@gmail.com', false)).toBe(
        'gmaxgomes+1@gmail.com',
      );
    });

    it('canonicalizes when enforcement is enabled', () => {
      expect(resolveEmailCanonical('gmaxgomes+1@gmail.com', true)).toBe(
        'gmaxgomes@gmail.com',
      );
    });
  });
});
