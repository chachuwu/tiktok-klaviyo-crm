import {
  normalizeEmail,
  normalizePhone,
  normalizeName,
  normalizeZip,
  normalizeGeo,
  parseFullName,
} from '../src/normalization/normalizer';

describe('normalizeEmail', () => {
  it('lowercases uppercase email', () => {
    expect(normalizeEmail('TEST@EXAMPLE.COM')).toBe('test@example.com');
  });

  it('trims whitespace', () => {
    expect(normalizeEmail('  user@example.com  ')).toBe('user@example.com');
  });

  it('handles mixed case with spaces', () => {
    expect(normalizeEmail('  User.Name@Example.COM  ')).toBe('user.name@example.com');
  });

  it('handles empty string', () => {
    expect(normalizeEmail('')).toBe('');
  });

  it('handles already normalized email', () => {
    expect(normalizeEmail('user@example.com')).toBe('user@example.com');
  });
});

describe('normalizePhone', () => {
  it('normalizes 10-digit US phone to E.164', () => {
    expect(normalizePhone('4155551234')).toBe('+14155551234');
  });

  it('normalizes formatted US phone', () => {
    expect(normalizePhone('(415) 555-1234')).toBe('+14155551234');
  });

  it('normalizes US phone with dashes', () => {
    expect(normalizePhone('415-555-1234')).toBe('+14155551234');
  });

  it('normalizes US phone with country code', () => {
    expect(normalizePhone('+14155551234')).toBe('+14155551234');
  });

  it('normalizes 11-digit US phone starting with 1', () => {
    expect(normalizePhone('14155551234')).toBe('+14155551234');
  });

  it('handles international phone with + prefix', () => {
    expect(normalizePhone('+447700900000')).toBe('+447700900000');
  });

  it('handles phone with 00 international prefix', () => {
    expect(normalizePhone('00447700900000')).toBe('+447700900000');
  });

  it('returns empty string for empty input', () => {
    expect(normalizePhone('')).toBe('');
  });
});

describe('normalizeName', () => {
  it('lowercases name', () => {
    expect(normalizeName('JOHN')).toBe('john');
  });

  it('trims whitespace', () => {
    expect(normalizeName('  John  ')).toBe('john');
  });

  it('handles empty string', () => {
    expect(normalizeName('')).toBe('');
  });
});

describe('normalizeZip', () => {
  it('strips non-alphanumeric characters', () => {
    expect(normalizeZip('90210')).toBe('90210');
  });

  it('handles ZIP+4 format', () => {
    expect(normalizeZip('90210-1234')).toBe('902101234');
  });
});

describe('normalizeGeo', () => {
  it('trims and lowercases', () => {
    expect(normalizeGeo('  United States  ')).toBe('united states');
  });
});

describe('parseFullName', () => {
  it('splits first and last name on first space', () => {
    const result = parseFullName('John Doe');
    expect(result.first_name).toBe('John');
    expect(result.last_name).toBe('Doe');
  });

  it('handles single-word name', () => {
    const result = parseFullName('Madonna');
    expect(result.first_name).toBe('Madonna');
    expect(result.last_name).toBe('');
  });

  it('handles three-word name (first space split)', () => {
    const result = parseFullName('Mary Jane Watson');
    expect(result.first_name).toBe('Mary');
    expect(result.last_name).toBe('Jane Watson');
  });

  it('handles empty string', () => {
    const result = parseFullName('');
    expect(result.first_name).toBe('');
    expect(result.last_name).toBe('');
  });

  it('handles whitespace-only string', () => {
    const result = parseFullName('   ');
    expect(result.first_name).toBe('');
    expect(result.last_name).toBe('');
  });

  it('handles leading/trailing whitespace', () => {
    const result = parseFullName('  John Doe  ');
    expect(result.first_name).toBe('John');
    expect(result.last_name).toBe('Doe');
  });
});
