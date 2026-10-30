import { expect, test } from 'vitest';
import { readerTextUrlPattern, readerLanguageUrlPattern } from '../utils/readerOfflineRoutes.mjs';

test.each(['/api/texts/12', '/api/Texts/12?refresh=true', '/api/texts/12/content'])('caches actual reader DTO URL %s', path => {
  expect(readerTextUrlPattern.test(`https://reader.example${path}`)).toBe(true);
});
test.each(['/api/languages/3', '/api/words/language/3?skipSort=true'])('caches reader language dependency %s', path => {
  expect(readerLanguageUrlPattern.test(`https://reader.example${path}`)).toBe(true);
});
test.each(['/api/texts/12/complete', '/api/texts/admin/relink-all', '/api/activity/logListening', '/api/languages', '/api/words/3'])('excludes unrelated API URL %s', path => {
  expect(readerTextUrlPattern.test(`https://reader.example${path}`)).toBe(false);
  expect(readerLanguageUrlPattern.test(`https://reader.example${path}`)).toBe(false);
});
