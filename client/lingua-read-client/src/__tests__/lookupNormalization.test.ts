import { test, expect } from 'vitest';
import { lowercaseLookupTerm } from '../utils/readerText';

test.each([
  ['en', 'DON’T', "don't"],
  ['de', 'Gru\u0308ße', 'grüße'],
  ['es', 'co\u00adrazón', 'corazón'],
  ['ro', 'S\u0326TIU', 'știu'],
  [undefined, 'Don’t', "don't"],
])('normalizes lookup keys universally for %s', (code, input, expected) => {
  expect(lowercaseLookupTerm(input, code)).toBe(expected);
});
