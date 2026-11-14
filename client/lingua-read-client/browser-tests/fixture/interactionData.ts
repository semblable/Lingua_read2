import { consumeWordAt, isPureNumericToken, normalizeTokenizerInput, prepareLanguageContext, stripLookupDiacritics } from '../../src/utils/readerText';
import type { LanguageConfig } from '../../src/utils/readerText';
import { createKoreanLookup, findKoreanLookupMatches, isKoreanLanguageCode, resolveKoreanLookup } from '../../src/utils/koreanLookup';
import { createReaderOccurrence } from '../../src/utils/readerInteraction';
import type { ReaderOccurrence } from '../../src/utils/readerInteraction';

export type SpikeScenario = 'mixed' | 'first-read' | 'rtl' | 'korean' | 'transcript';
export type SpikePiece = { text: string; occurrence?: ReaderOccurrence };
export type SpikeBlock = { id: string; text: string; languageCode: string; pieces: SpikePiece[] };
export type SpikePassage = { blocks: SpikeBlock[]; occurrences: ReaderOccurrence[]; initialStatuses: Record<string, number>; direction: 'ltr' | 'rtl' };

const authoredSamples = [
  ['en', 'Alpha Beta Alpha New York harbour waits.'],
  ['fr', 'Éloïse aperçoit une rivière limpide près du café où grandit un garçon.'],
  ['en', 'Agile glyphs gently dip; e\u0301 and 𠮷 retain their source coordinates.'],
  ['ar', 'نَهْرٌ هادئ يمر قرب بيت صغير.'],
  ['he', 'נָהָר שקט עובר ליד בית קטן.'],
  ['zh', '河边的小猫看见一盏灯。'],
  ['ja', '𠮷さんは静かな川を見ています。'],
  ['ko', '한국 학교 옆에서 작은 강을 봅니다.'],
  ['th', 'แมวตัวเล็กมองแม่น้ำเงียบสงบ'],
] as const;

/** Synthetic renderer adapter, deliberately outside production. It walks the same
 * substituted text/consumeWordAt seam; no whitespace splitting or DOM word search. */
export function buildSpikePassage(generation: string, scenario: SpikeScenario): SpikePassage {
  const samples: readonly (readonly [string, string])[] = scenario === 'transcript' ?
    Array.from({ length: 100 }, (_, index) => ['en', `Cue ${index + 1}: Alpha crosses the quiet river and returns.`] as const) :
    scenario === 'rtl' ? [['ar', 'نَهْرٌ هادئ نَهْرٌ يمر قرب بيت صغير.'], ['he', 'נָהָר שקט נָהָר עובר ליד בית קטן.']] :
    scenario === 'korean' ? [['ko', '한국 학교 옆에서 한국 학교 학생을 봅니다.']] :
    scenario === 'first-read' ? Array.from({ length: 8 }, (_, index) => ['en', `Passage ${index + 1}: Curious learners examine unfamiliar vocabulary beside a gentle river.`] as const) : authoredSamples;
  const initialStatuses: Record<string, number> = {};
  const occurrences: ReaderOccurrence[] = [];
  const blocks = samples.map(([languageCode, text], index): SpikeBlock => {
    const id = `source-${index}`;
    const config: LanguageConfig = { code: languageCode,
      parserType: languageCode === 'ja' ? 'tinysegmenter-ja-v1' : null };
    const { processed, coreRegex, wordEnds } = prepareLanguageContext(text, config);
    const phrases = (languageCode === 'ko' ? ['한국 학교'] : ['New York harbour', 'New York'])
      .sort((a, b) => b.length - a.length);
    const korean = isKoreanLanguageCode(languageCode) ? createKoreanLookup(phrases, term => term) : null;
    const koreanMatches = korean ? phrases.flatMap(term => findKoreanLookupMatches(processed, term)
      .filter(span => resolveKoreanLookup(korean, processed.slice(span.start, span.end)) === term)
      .map(span => ({ ...span, term }))).sort((a, b) => b.end - b.start - (a.end - a.start)) : [];
    const pieces: SpikePiece[] = [];
    let cursor = 0;
    while (cursor < processed.length) {
      const alias = koreanMatches.find(span => span.start === cursor);
      const phrase = alias?.term ?? (!korean ? phrases.find(term =>
        stripLookupDiacritics(processed.slice(cursor, cursor + term.length), languageCode) === stripLookupDiacritics(term, languageCode)) : undefined);
      const consumed = phrase ? null : consumeWordAt(processed, cursor, coreRegex, wordEnds);
      if (phrase || consumed) {
        const end = alias?.end ?? (phrase ? cursor + phrase.length : consumed!.end);
        const term = processed.slice(cursor, end);
        const entityKey = `synthetic:${scenario}:${languageCode}:${stripLookupDiacritics(phrase ?? term, languageCode)}`;
        const occurrence = createReaderOccurrence({ generation, blockId: id, processedText: processed, start: cursor, end, term,
          entityKey, sentence: processed, languageCode });
        occurrences.push(occurrence);
        pieces.push({ text: term, occurrence });
        initialStatuses[entityKey] ??= isPureNumericToken(term) || term === 'and' ? 6 : term === 'the' ? 5 :
          scenario === 'first-read' ? 0 : Object.keys(initialStatuses).length % 7;
        cursor = end;
      } else {
        const width = processed.codePointAt(cursor)! > 0xffff ? 2 : 1;
        pieces.push({ text: processed.slice(cursor, cursor + width) });
        cursor += width;
      }
    }
    // StandardTextView's sentence seam composes supported runs before invoking
    // processTextContent. Store that same renderer boundary, including UTF-16 length.
    return { id, text: normalizeTokenizerInput(text), languageCode, pieces };
  });
  return { blocks, occurrences, initialStatuses, direction: scenario === 'rtl' ? 'rtl' : 'ltr' };
}
