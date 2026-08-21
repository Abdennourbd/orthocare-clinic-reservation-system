/**
 * Normalizes an Algerian phone number to E.164 format.
 * Returns the normalized string, or null if it cannot be recognized as a valid Algerian number.
 * 
 * E.164 format for Algeria: +213 followed by 9 digits (no leading 0 in the local part).
 * Examples:
 *  - 0550123456 -> +213550123456
 *  - +213 550 12 34 56 -> +213550123456
 *  - 00213550123456 -> +213550123456
 */
export function normalizePhoneE164(phone: string): string | null {
  // Remove all non-digit characters except leading plus
  let cleaned = phone.replace(/[^\d+]/g, '');

  if (cleaned.startsWith('+213')) {
    cleaned = cleaned.substring(4);
  } else if (cleaned.startsWith('00213')) {
    cleaned = cleaned.substring(5);
  } else if (cleaned.startsWith('213')) {
    cleaned = cleaned.substring(3);
  } else if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }

  // Algerian mobile and landline numbers without the leading 0 are 9 digits long
  if (/^\d{9}$/.test(cleaned)) {
    return `+213${cleaned}`;
  }

  return null;
}
