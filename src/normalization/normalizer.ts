/**
 * Normalizes an email address: trim whitespace and convert to lowercase.
 */
export function normalizeEmail(email: string): string {
  if (!email) return '';
  return email.trim().toLowerCase();
}

/**
 * Normalizes a phone number to E.164 format.
 * Strips non-digit characters, detects international prefix,
 * defaults to +1 (US) if no country code detected.
 */
export function normalizePhone(phone: string): string {
  if (!phone) return '';

  // Remove all non-digit characters except leading +
  const cleaned = phone.trim().replace(/[^\d+]/g, '');

  // If already in E.164 format (starts with +)
  if (cleaned.startsWith('+')) {
    const digits = cleaned.slice(1).replace(/\D/g, '');
    return '+' + digits;
  }

  const digits = cleaned.replace(/\D/g, '');

  if (!digits) return '';

  // If starts with '00' (international prefix)
  if (digits.startsWith('00')) {
    return '+' + digits.slice(2);
  }

  // US/Canada: 10 digits, add +1
  if (digits.length === 10) {
    return '+1' + digits;
  }

  // US with country code: 11 digits starting with 1
  if (digits.length === 11 && digits.startsWith('1')) {
    return '+' + digits;
  }

  // Other international numbers (11+ digits with country code)
  if (digits.length > 10) {
    return '+' + digits;
  }

  // Fallback: add +1 if short
  return '+1' + digits;
}

/**
 * Normalizes a name: trim whitespace and convert to lowercase.
 */
export function normalizeName(name: string): string {
  if (!name) return '';
  return name.trim().toLowerCase();
}

/**
 * Normalizes a ZIP/postal code: strip non-alphanumeric characters.
 */
export function normalizeZip(zip: string): string {
  if (!zip) return '';
  return zip.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

/**
 * Normalizes a geographic value: trim whitespace and convert to lowercase.
 */
export function normalizeGeo(value: string): string {
  if (!value) return '';
  return value.trim().toLowerCase();
}

/**
 * Parses a full name string into first and last name components.
 * Splits on the first space. If no space, entire string is first name.
 */
export function parseFullName(fullName: string): { first_name: string; last_name: string } {
  if (!fullName || !fullName.trim()) {
    return { first_name: '', last_name: '' };
  }

  const trimmed = fullName.trim();
  const spaceIndex = trimmed.indexOf(' ');

  if (spaceIndex === -1) {
    return { first_name: trimmed, last_name: '' };
  }

  const first_name = trimmed.slice(0, spaceIndex).trim();
  const last_name = trimmed.slice(spaceIndex + 1).trim();

  return { first_name, last_name };
}
