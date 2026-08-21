/**
 * Normalizes an Algerian phone number to E.164 format.
 * Returns the normalized string, or null if it cannot be recognized as a valid Algerian number.
 *
 * E.164 format for Algeria: +213 followed by the national subscriber number:
 *   - Mobile:    9 digits starting with 5, 6, or 7  (e.g. 0550 12 34 56 -> +213550123456)
 *   - Fixed line: 8 digits starting with 2, 3, or 4  (e.g. 021 65 43 21 -> +21321654321)
 *
 * Arabic-Indic (٠-٩) and Persian (۰-۹) digits are accepted, since an Arabic-locale
 * patient may type them; `\d` alone matches ASCII [0-9] only and would strip them.
 * Examples:
 *  - 0550123456 -> +213550123456
 *  - +213 550 12 34 56 -> +213550123456
 *  - 00213550123456 -> +213550123456
 *  - ٠٥٥٠١٢٣٤٥٦ -> +213550123456
 *  - 021 65 43 21 -> +21321654321
 */
const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

function toAsciiDigits(input: string): string {
  let out = "";
  for (const ch of input) {
    const arabicIdx = ARABIC_INDIC_DIGITS.indexOf(ch);
    if (arabicIdx !== -1) {
      out += String(arabicIdx);
      continue;
    }
    const persianIdx = PERSIAN_DIGITS.indexOf(ch);
    if (persianIdx !== -1) {
      out += String(persianIdx);
      continue;
    }
    out += ch;
  }
  return out;
}

export function normalizePhoneE164(phone: string): string | null {
  // Convert non-ASCII digits first, then drop everything except digits and a leading plus.
  const cleaned = toAsciiDigits(phone).replace(/[^\d+]/g, "");

  let subscriber: string;
  if (cleaned.startsWith("+213")) {
    subscriber = cleaned.substring(4);
  } else if (cleaned.startsWith("00213")) {
    subscriber = cleaned.substring(5);
  } else if (cleaned.startsWith("213")) {
    subscriber = cleaned.substring(3);
  } else if (cleaned.startsWith("0")) {
    subscriber = cleaned.substring(1);
  } else {
    subscriber = cleaned;
  }

  // Mobile: 9 digits starting with 5, 6, or 7.
  if (/^[567]\d{8}$/.test(subscriber)) {
    return `+213${subscriber}`;
  }
  // Fixed line: 8 digits starting with 2, 3, or 4.
  if (/^[234]\d{7}$/.test(subscriber)) {
    return `+213${subscriber}`;
  }

  return null;
}
