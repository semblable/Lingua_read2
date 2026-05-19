import { describe, test, expect } from 'vitest';
import { extractTranslatedTextFromPairedTags } from '../utils/translationTags';

describe('extractTranslatedTextFromPairedTags', () => {
  test('extracts the <t> segments and joins them with a space', () => {
    const input = '<o s="1">El</o><t s="1">The</t><o s="2">gato</o><t s="2">cat</t>';
    expect(extractTranslatedTextFromPairedTags(input)).toBe('The cat');
  });

  test('sorts segments by their s attribute regardless of source order', () => {
    const input = '<t s="2">cat</t><t s="1">The</t>';
    expect(extractTranslatedTextFromPairedTags(input)).toBe('The cat');
  });

  test('returns the trimmed content of a single <t> tag', () => {
    expect(extractTranslatedTextFromPairedTags('<t s="1">  hello  </t>')).toBe('hello');
  });

  test('trims whitespace inside each tag', () => {
    const input = '<t s="1">\n  foo \n</t><t s="2"> bar </t>';
    expect(extractTranslatedTextFromPairedTags(input)).toBe('foo bar');
  });

  test('accepts single quotes around the sequence attribute', () => {
    expect(extractTranslatedTextFromPairedTags("<t s='1'>foo</t><t s='2'>bar</t>")).toBe('foo bar');
  });

  test('returns empty string for null, undefined, and non-string values', () => {
    expect(extractTranslatedTextFromPairedTags(null)).toBe('');
    expect(extractTranslatedTextFromPairedTags(undefined)).toBe('');
    expect(extractTranslatedTextFromPairedTags(42)).toBe('');
    expect(extractTranslatedTextFromPairedTags({})).toBe('');
    expect(extractTranslatedTextFromPairedTags([])).toBe('');
  });

  test('returns empty string for empty string input', () => {
    expect(extractTranslatedTextFromPairedTags('')).toBe('');
  });

  test('falls back to the trimmed raw input when no <t> tags are present', () => {
    expect(extractTranslatedTextFromPairedTags('  plain translation  ')).toBe('plain translation');
  });

  test('falls back to raw input when tags are malformed (missing s attr)', () => {
    const input = '<t>no sequence</t>';
    expect(extractTranslatedTextFromPairedTags(input)).toBe(input);
  });

  test('handles content that spans newlines inside the tag', () => {
    const input = '<t s="1">line one\nline two</t>';
    expect(extractTranslatedTextFromPairedTags(input)).toBe('line one\nline two');
  });

  test('ignores <o> tags entirely', () => {
    expect(extractTranslatedTextFromPairedTags('<o s="1">should ignore</o>')).toBe(
      '<o s="1">should ignore</o>'
    );
  });
});
