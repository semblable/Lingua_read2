import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LANGUAGE_PRESETS, baseLanguageCode, languagePresetInput } from '../utils/languagePresets';
import { extractWords } from '../utils/readerText';
import { toSpeechLanguageTag } from '../utils/browserTts';

describe('language preset reading configurations', () => {
  test.each([
    ['pl', 'Zażółć gęślą jaźń', ['Zażółć', 'gęślą', 'jaźń']],
    ['hi', 'हिन्दी भाषा', ['हिन्दी', 'भाषा']],
    ['fa', 'می‌روم خانه', ['می‌روم', 'خانه']],
    ['vi', 'Tiếng Việt', ['Tiếng', 'Việt']],
    ['ar', 'اللغة العربية', ['اللغة', 'العربية']],
    ['ko', '한국어 공부', ['한국어', '공부']],
  ])('%s preserves letters, combining marks and internal joiners', (code, text, words) => {
    const input = languagePresetInput(LANGUAGE_PRESETS.find(preset => preset.code === code)!);
    expect(extractWords(text, input)).toEqual(words);
  });

  test('every catalog flag is a bundled SVG rather than a remote request', () => {
    for (const preset of LANGUAGE_PRESETS) {
      const asset = resolve('public', 'flags', `${preset.flag}.svg`);
      expect(readFileSync(asset, 'utf8')).toContain('<svg');
    }
  });

  test('recognizes regional tags and browser legacy aliases', () => {
    expect(baseLanguageCode(' PL_pl ')).toBe('pl');
    expect(baseLanguageCode('iw-IL')).toBe('he');
    expect(baseLanguageCode('nb-NO')).toBe('no');
    expect(baseLanguageCode('nn-NO')).toBe('no');
  });

  test('all 44 presets have valid speech tags without requiring regional duplicates', () => {
    expect(LANGUAGE_PRESETS).toHaveLength(44);
    for (const preset of LANGUAGE_PRESETS) {
      expect(() => Intl.getCanonicalLocales(toSpeechLanguageTag(preset.code))).not.toThrow();
    }
    expect(toSpeechLanguageTag('pt')).toBe('pt');
    expect(LANGUAGE_PRESETS.filter(preset => baseLanguageCode(preset.code) === 'pt')).toHaveLength(1);
    expect(toSpeechLanguageTag('nn-NO')).toBe('nn-NO');
  });
});
