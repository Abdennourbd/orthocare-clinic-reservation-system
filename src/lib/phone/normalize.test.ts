import { describe, it, expect } from 'vitest';
import { normalizePhoneE164 } from './normalize';

describe('normalizePhoneE164', () => {
  it('normalizes local 10-digit formats starting with 0', () => {
    expect(normalizePhoneE164('0550123456')).toBe('+213550123456');
    expect(normalizePhoneE164('0770 12 34 56')).toBe('+213770123456');
    expect(normalizePhoneE164('06-61-12-34-56')).toBe('+213661123456');
  });

  it('normalizes international formats with +213', () => {
    expect(normalizePhoneE164('+213550123456')).toBe('+213550123456');
    expect(normalizePhoneE164('+213 550 12 34 56')).toBe('+213550123456');
  });

  it('normalizes international formats with 00213', () => {
    expect(normalizePhoneE164('00213550123456')).toBe('+213550123456');
    expect(normalizePhoneE164('00213 550 12 34 56')).toBe('+213550123456');
  });

  it('normalizes formats with 213 (missing + or 00)', () => {
    expect(normalizePhoneE164('213550123456')).toBe('+213550123456');
  });

  it('returns null for invalid lengths', () => {
    expect(normalizePhoneE164('055012345')).toBeNull(); // Too short
    expect(normalizePhoneE164('05501234567')).toBeNull(); // Too long
    expect(normalizePhoneE164('+21355012345')).toBeNull(); // Too short
  });

  it('returns null for non-numeric input (after cleanup)', () => {
    expect(normalizePhoneE164('invalid')).toBeNull();
    expect(normalizePhoneE164('+213abc123456')).toBeNull();
  });
});
