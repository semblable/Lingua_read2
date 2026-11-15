import { normalizeTokenizerInput, splitBlockIntoSentences, type LanguageConfig } from './readerText';

/** Resolve a sentence by the selected DOM occurrence, rather than by searching for
 * its word text. A flowing paragraph may contain that word several times and a
 * sentence may continue into another timed cue.
 */
export function sentenceAtReaderOccurrence(scope: Element, occurrence: Element,
  languageConfig: LanguageConfig, languageCode?: string | null): string {
  if (!scope.contains(occurrence)) return '';
  const before = document.createRange();
  before.selectNodeContents(scope);
  before.setEndBefore(occurrence);
  const offset = normalizeTokenizerInput(before.toString()).length;
  const text = normalizeTokenizerInput(scope.textContent ?? '');
  let cursor = 0;
  for (const sentence of splitBlockIntoSentences(text, languageConfig, languageCode, true)) {
    // Looking up each segment after the previous one also accounts for whitespace
    // or isolated punctuation omitted by the sentence splitter's regex fallback.
    const start = text.indexOf(sentence, cursor);
    if (start < 0) continue;
    const end = start + sentence.length;
    if (offset >= start && offset < end) return sentence.replace(/\s+/gu, ' ').trim();
    cursor = end;
  }
  return '';
}
