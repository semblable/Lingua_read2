import { describe, expect, test } from 'vitest';
import { JAPANESE_SEGMENTER_PROFILE } from '../utils/japaneseSegmenter';
import {
  buildPhraseSelectionFromText,
  cleanSelectedReaderText,
  consumeWordAt,
  extractWords,
  prepareLanguageContext,
  splitSentenceAroundTerm,
  tokenizeContent
} from '../utils/readerText';

const japaneseProfiled = { parserType: JAPANESE_SEGMENTER_PROFILE, code: 'ja' };
const japaneseLegacy = { parserType: 'mecab', code: 'ja' };

describe('Japanese reader token integration', () => {
  test('new tinysegmenter-ja-v1 profile segments Japanese runs while legacy mecab keeps whole-run boundaries', () => {
    const text = '🙂私は昨日図書館で日本語の本を読みました。OpenAI2026';
    const result = tokenizeContent(text, japaneseProfiled);
    expect(result.tokens.map(token => token.text).join('')).toBe(text);
    expect(result.tokens.filter(token => token.type === 'word').map(token => token.text)).toEqual([
      '私', 'は', '昨日', '図書館', 'で', '日本語', 'の', '本', 'を', '読み', 'まし', 'た', 'OpenAI'
    ]);
    expect(result.tokens[0]).toEqual({ type: 'separator', text: '🙂', start: 0, end: 2 });

    expect(extractWords('𠮷野家で食べる。', japaneseProfiled)).toEqual(['𠮷野家', 'で', '食べる']);
    expect(tokenizeContent('私は昨日図書館で日本語の本を読みました', japaneseLegacy).tokens).toHaveLength(1);
  });

  test('consumeWordAt recovers cleanly when a saved phrase ends mid-run', () => {
    const sentence = '私は昨日図書館で日本語の本を読みました。';
    const context = prepareLanguageContext(sentence, japaneseProfiled);
    expect(consumeWordAt(context.processed, 0, context.coreRegex, context.wordEnds)).toEqual({
      text: '私',
      end: 1
    });
    // Simulate a saved phrase ending at index 5 inside '図書館' (indices 4..7)
    const midRun = consumeWordAt(context.processed, 5, context.coreRegex, context.wordEnds);
    expect(midRun).not.toBeNull();
    expect(midRun!.end).toBeGreaterThan(5);
    expect(midRun!.text).toBe(context.processed.slice(5, midRun!.end));
  });

  test('cleanSelectedReaderText, buildPhraseSelectionFromText, and splitSentenceAroundTerm work on segmented Japanese', () => {
    const sentence = '私は昨日図書館で日本語の本を読みました。';
    expect(cleanSelectedReaderText('「日本語の本。」', japaneseProfiled)).toBe('日本語の本');

    const phraseState = buildPhraseSelectionFromText('日本語の本', sentence, japaneseProfiled);
    expect(phraseState).not.toBeNull();
    expect(phraseState!.words.slice(phraseState!.startIndex, phraseState!.endIndex + 1)).toEqual([
      '日本語', 'の', '本'
    ]);

    const parts = splitSentenceAroundTerm('𠮷野家で食べる。', '𠮷野家', null, 'ja');
    expect(parts).toEqual([
      { text: '𠮷野家', isTerm: true },
      { text: 'で食べる。', isTerm: false }
    ]);
  });
});
