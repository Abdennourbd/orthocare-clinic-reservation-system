import { describe, it, expect } from 'vitest';
import { normalizePhoneE164 } from './normalize';

describe('normalizePhoneE164', () => {
  it('normalizes local 10-digit mobile formats starting with 0', () => {
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

  it('normalizes fixed-line numbers (8-digit subscriber starting with 2/3/4)', () => {
    expect(normalizePhoneE164('021654321')).toBe('+21321654321');
    expect(normalizePhoneE164('021 65 43 21')).toBe('+21321654321');
    expect(normalizePhoneE164('+21321654321')).toBe('+21321654321');
    expect(normalizePhoneE164('0021321654321')).toBe('+21321654321');
    expect(normalizePhoneE164('025 123 456')).toBe('+21325123456');
    expect(normalizePhoneE164('036987654')).toBe('+21336987654');
  });

  it('normalizes Arabic-Indic digits (٠-٩)', () => {
    expect(normalizePhoneE164('٠٥٥٠١٢٣٤٥٦')).toBe('+213550123456');
    expect(normalizePhoneE164('٠٢١٦٥٤٣٢١')).toBe('+21321654321');
  });

  it('normalizes Persian digits (۰-۹)', () => {
    expect(normalizePhoneE164('۰۵۵۰۱۲۳۴۵۶')).toBe('+213550123456');
  });

  it('rejects a mobile-shaped number with the wrong length', () => {
    expect(normalizePhoneE164('055012345')).toBeNull(); // 8 digits after trunk — mobile needs 9
    expect(normalizePhoneE164('05501234567')).toBeNull(); // 10 digits after trunk
    expect(normalizePhoneE164('+21355012345')).toBeNull();
    expect(normalizePhoneE164('055012345678')).toBeNull();
  });

  it('rejects a fixed-line-shaped number with the wrong length', () => {
    expect(normalizePhoneE164('02165432')).toBeNull(); // 7 digits after trunk
    expect(normalizePhoneE164('0216543210')).toBeNull(); // 9 digits after trunk — fixed needs 8
  });

  it('rejects non-numeric input (after cleanup)', () => {
    expect(normalizePhoneE164('invalid')).toBeNull();
    expect(normalizePhoneE164('+213abc123456')).toBeNull();
    expect(normalizePhoneE164('+0550123456')).toBeNull();
  });
});
