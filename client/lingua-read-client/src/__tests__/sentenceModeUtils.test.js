import { clampSpeechRate, toSpeechLanguageTag } from '../utils/browserTts';
import { parseSentenceExplanation } from '../utils/parseSentenceExplanation';

describe('parseSentenceExplanation', () => {
  test('splits labeled sections into structured content', () => {
    const parsed = parseSentenceExplanation(
      'Grammar: Subject + verb.\nNuance: Emphasizes both quantity and quality.\nCulture/Context: None\nNatural phrasing: A natural rewrite.'
    );

    expect(parsed.fallback).toBeNull();
    expect(parsed.sections).toHaveLength(4);
    expect(parsed.sections[0]).toEqual({
      id: 'grammar',
      label: 'Grammar',
      body: 'Subject + verb.'
    });
    expect(parsed.sections[2].body).toBe('None');
  });

  test('keeps raw text when expected labels are missing', () => {
    const parsed = parseSentenceExplanation('Free-form explanation without section labels.');

    expect(parsed.sections).toEqual([]);
    expect(parsed.fallback).toBe('Free-form explanation without section labels.');
  });
});

describe('browserTts helpers', () => {
  test('maps language codes to speech-friendly BCP 47 tags', () => {
    expect(toSpeechLanguageTag('PT')).toBe('pt-BR');
    expect(toSpeechLanguageTag('es')).toBe('es-ES');
    expect(toSpeechLanguageTag('pt-pt')).toBe('pt-PT');
  });

  test('clamps invalid or out-of-range rates', () => {
    expect(clampSpeechRate(undefined)).toBe(1);
    expect(clampSpeechRate(0.1)).toBe(0.5);
    expect(clampSpeechRate(2)).toBe(1.5);
    expect(clampSpeechRate(1.2)).toBe(1.2);
  });
});
