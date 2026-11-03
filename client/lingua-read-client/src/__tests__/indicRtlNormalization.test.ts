import { describe, it, expect } from 'vitest';
import {
  tokenizeContent,
  extractWords,
  lowercaseLookupTerm,
  stripLookupDiacritics,
  type LanguageConfig,
} from '../utils/readerText';

const createLang = (code: string, wordCharacters = '\\p{L}\\p{M}\\u200C\\u200D', characterSubstitutions = ''): LanguageConfig => ({
  code,
  languageCode: code,
  wordCharacters,
  characterSubstitutions,
  splitSentences: '.!?',
  parserType: 'spacedel',
});

const hi = createLang('hi', '\\p{L}\\p{M}\\u200C\\u200D');
const bn = createLang('bn', '\\p{L}\\p{M}\\u200C\\u200D');
const ta = createLang('ta', '\\p{L}\\p{M}\\u200C\\u200D');
const ar = createLang('ar', '\\p{L}\\p{M}');
const arWithDigits = createLang('ar', '\\p{L}\\p{M}\\p{N}');
const fa = createLang('fa', '\\p{L}\\p{M}\\u200C\\u200D');
const he = createLang('he', '\\p{L}\\p{M}');
const heWithDigits = createLang('he', '\\p{L}\\p{M}\\p{N}');
const ur = createLang('ur', '\\p{L}\\p{M}\\u200C\\u200D');
const ru = createLang('ru', '\\p{L}\\p{M}');
const uk = createLang('uk', '\\p{L}\\p{M}');
const lt = createLang('lt', '\\p{L}\\p{M}');

const wordsOf = (content: string, lang: LanguageConfig): string[] =>
  extractWords(content, lang);

const lookupKeysOf = (content: string, lang: LanguageConfig): string[] =>
  extractWords(content, lang).map((word) => lowercaseLookupTerm(word, lang?.code));

describe('Indic and RTL Script Normalization & Diacritic Insensitive Lookup', () => {
  describe('Indic Scripts: Hindi, Bengali, Tamil', () => {
    it('hi-01: preserves Nukta and Virama, excludes Purna Viram', () => {
      const input = 'ग़ज़ल में ख़ास लफ़्ज़ हैं।';
      expect(wordsOf(input, hi)).toEqual(['ग़ज़ल', 'में', 'ख़ास', 'लफ़्ज़', 'हैं']);
    });

    it('hi-02: preserves ZWNJ, trailing halant, excludes double Danda', () => {
      const input = 'श्रीमान् ने क्\u200Cष और क्ष का अंतर बताया॥';
      const words = wordsOf(input, hi);
      expect(words).toEqual(['श्रीमान्', 'ने', 'क्\u200Cष', 'और', 'क्ष', 'का', 'अंतर', 'बताया']);
      expect(words[2]).toContain('\u200C');
    });

    it('bn-01: preserves ZWJ and ZWNJ', () => {
      const input = 'র\u200D্যাব ও র\u200C্যাব কি এক?';
      const words = wordsOf(input, bn);
      expect(words).toEqual(['র\u200D্যাব', 'ও', 'র\u200C্যাব', 'কি', 'এক']);
      expect(words[0]).toContain('\u200D');
      expect(words[2]).toContain('\u200C');
    });

    it('bn-02: preserves Nukta, excludes Dari', () => {
      const input = 'আষাঢ় মাসে প্রচুর বৃষ্টি হয়।';
      expect(wordsOf(input, bn)).toEqual(['আষাঢ়', 'মাসে', 'প্রচুর', 'বৃষ্টি', 'হয়']);
    });

    it('ta-01: preserves Aytham and Pulli', () => {
      const input = 'அஃது தமிழ் மொழியின் சிறப்பு!';
      expect(wordsOf(input, ta)).toEqual(['அஃது', 'தமிழ்', 'மொழியின்', 'சிறப்பு']);
    });

    it('ta-02: preserves Grantha ligatures', () => {
      const input = 'க்ஷத்ரியர் மற்றும் ஸ்ரீநிவாசன் வந்தனர்.';
      expect(wordsOf(input, ta)).toEqual(['க்ஷத்ரியர்', 'மற்றும்', 'ஸ்ரீநிவாசன்', 'வந்தனர்']);
    });
  });

  describe('RTL Scripts: Arabic, Persian, Hebrew, Urdu', () => {
    it('ar-01: strips Tashkeel/Harakat for lookup keys', () => {
      const input = 'كَتَبَ الطَّالِبُ «كِتَابًا» فِي عَامِ 2026، وَقَالَتْ: «مَرْحَبًا!»';

      expect(wordsOf(input, ar)).toEqual(['كَتَبَ', 'الطَّالِبُ', 'كِتَابًا', 'فِي', 'عَامِ', 'وَقَالَتْ', 'مَرْحَبًا']);
      expect(lookupKeysOf(input, ar)).toEqual(['كتب', 'الطالب', 'كتابا', 'في', 'عام', 'وقالت', 'مرحبا']);

      expect(wordsOf(input, arWithDigits)).toEqual(['كَتَبَ', 'الطَّالِبُ', 'كِتَابًا', 'فِي', 'عَامِ', '2026', 'وَقَالَتْ', 'مَرْحَبًا']);
      expect(lookupKeysOf(input, arWithDigits)).toEqual(['كتب', 'الطالب', 'كتابا', 'في', 'عام', '2026', 'وقالت', 'مرحبا']);
    });

    it('ar-02: BiDi RTL/LTR mixing and Tashkeel stripping', () => {
      const input = 'أَطْلَقَتْ شَرِكَةُ OpenAI نُسْخَةَ 2026 وَقَالَتْ: «مَرْحَبًا!»';
      expect(lookupKeysOf(input, arWithDigits)).toEqual(['أطلقت', 'شركة', 'openai', 'نسخة', '2026', 'وقالت', 'مرحبا']);
    });

    it('Arabic: strips Tatweel and Harakat for lookup keys', () => {
      const tatweelWord = 'مَـكْـتَـبَـةِ';
      expect(lowercaseLookupTerm(tatweelWord, 'ar')).toBe('مكتبة');
    });

    it('fa-01: preserves multiple ZWNJ in surface tokens and lookup keys', () => {
      const input = 'من به کتاب\u200Cخانه\u200Cهای بزرگ می\u200Cروم؟';
      expect(wordsOf(input, fa)).toEqual(['من', 'به', 'کتاب\u200Cخانه\u200Cهای', 'بزرگ', 'می\u200Cروم']);
      expect(lookupKeysOf(input, fa)).toEqual(['من', 'به', 'کتاب\u200Cخانه\u200Cهای', 'بزرگ', 'می\u200Cروم']);
    });

    it('fa-02: strips Kasra and Hamza above for lookup keys', () => {
      const input = 'او ۴۵٬۰۰۰ ریال برایِ خانهٔ نو داد.';
      const words = wordsOf(input, fa);
      expect(words).toContain('برایِ');
      expect(words).toContain('خانهٔ');

      expect(lowercaseLookupTerm('برایِ', 'fa')).toBe('برای');
      expect(lowercaseLookupTerm('خانهٔ', 'fa')).toBe('خانه');
    });

    it('he-01: preserves Gershayim, Maqaf splits words, strips Niqqud for lookup keys', () => {
      const input = 'הַאִם קָרָאתָ אֶת הַדּוּ״חַ שֶׁל צה״ל בְּ־2026?';

      expect(wordsOf(input, he)).toEqual(['הַאִם', 'קָרָאתָ', 'אֶת', 'הַדּוּ״חַ', 'שֶׁל', 'צה״ל', 'בְּ']);
      expect(lookupKeysOf(input, he)).toEqual(['האם', 'קראת', 'את', 'הדו״ח', 'של', 'צה״ל', 'ב']);

      // With digits enabled, Maqaf ־ is not a connector, so בְּ and 2026 split cleanly
      expect(wordsOf(input, heWithDigits)).toEqual(['הַאִם', 'קָרָאתָ', 'אֶת', 'הַדּוּ״חַ', 'שֶׁל', 'צה״ל', 'בְּ', '2026']);
      expect(lookupKeysOf(input, heWithDigits)).toEqual(['האם', 'קראת', 'את', 'הדו״ח', 'של', 'צה״ל', 'ב', '2026']);
    });

    it('he-02: preserves Gershayim and ASCII quotes in acronyms', () => {
      const input1 = 'חברת Apple מכרה 1,500 מכשירים בת״א.';
      const words1 = wordsOf(input1, he);
      expect(words1).toContain('בת״א');
      expect(lowercaseLookupTerm('בת״א', 'he')).toBe('בת״א');

      // ASCII quote inside Hebrew acronym
      const input2 = 'הדו"ח של צה"ל';
      const words2 = wordsOf(input2, he);
      expect(words2).toEqual(['הדו"ח', 'של', 'צה"ל']);
      expect(lookupKeysOf(input2, he)).toEqual(['הדו"ח', 'של', 'צה"ל']);

      // Hebrew Geresh inside acronym
      const input3 = 'תנ״ך וגב׳ כהן';
      const words3 = wordsOf(input3, he);
      expect(words3[0]).toBe('תנ״ך');
    });

    it('ur-01: preserves ZWNJ', () => {
      const input = 'کیا آپ کل اسلام\u200Cآباد جائیں\u200Cگے؟';
      const words = wordsOf(input, ur);
      expect(words).toEqual(['کیا', 'آپ', 'کل', 'اسلام\u200Cآباد', 'جائیں\u200Cگے']);
      expect(words[4]).toContain('\u200C');
    });

    it('ur-02: strips Pesh for lookup', () => {
      const input = 'اُس نے کہا: ”پڑھائی مکمل ہوئی۔“';
      const words = wordsOf(input, ur);
      expect(words).toEqual(['اُس', 'نے', 'کہا', 'پڑھائی', 'مکمل', 'ہوئی']);
      expect(lookupKeysOf(input, ur)).toEqual(['اس', 'نے', 'کہا', 'پڑھائی', 'مکمل', 'ہوئی']);
      expect(lowercaseLookupTerm('اُس', 'ur')).toBe('اس');
    });
  });

  describe('European Stress Marks & Accents: Russian, Ukrainian, Lithuanian', () => {
    it('ru: strips combining acute stress mark', () => {
      const withStress = 'молоко\u0301';
      expect(stripLookupDiacritics(withStress, 'ru')).toBe('молоко');
      expect(lowercaseLookupTerm(withStress, 'ru')).toBe('молоко');
      expect(lookupKeysOf(withStress, ru)).toEqual(['молоко']);
    });

    it('uk: strips combining acute stress mark and preserves apostrophe', () => {
      const withStress = "п'я\u0301ть";
      expect(stripLookupDiacritics(withStress, 'uk')).toBe("п'ять");
      expect(lowercaseLookupTerm(withStress, 'uk')).toBe("п'ять");
      expect(lookupKeysOf(withStress, uk)).toEqual(["п'ять"]);
    });

    it('lt: strips combining accents', () => {
      const word = 'ė\u0301jo';
      expect(stripLookupDiacritics(word, 'lt')).toBe('ėjo');
      expect(lowercaseLookupTerm(word, 'lt')).toBe('ėjo');
      expect(lookupKeysOf(word, lt)).toEqual(['ėjo']);
    });
  });

  describe('stripLookupDiacritics edge cases and regional codes', () => {
    const cases: [string | null | undefined, string, string][] = [
      ['ar-SA', 'كَتَبَ', 'كتب'],
      ['fa-IR', 'خانهٔ', 'خانه'],
      ['ur-PK', 'اُس', 'اس'],
      ['he-IL', 'הַאִם', 'האם'],
      ['iw', 'הַאִם', 'האם'], // Legacy Hebrew ISO code
      ['ru-RU', 'молоко\u0301', 'молоко'],
      ['uk-UA', "п'я\u0301ть", "п'ять"],
      ['lt-LT', 'ė\u0301jo', 'ėjo'],
      ['en', "don't", "don't"],
      [null, 'كَتَبَ', 'كَتَبَ'],
      [undefined, 'كَتَبَ', 'كَتَبَ'],
    ];

    it.each(cases)('handles locale %s for %s -> %s', (langCode, input, expected) => {
      expect(stripLookupDiacritics(input, langCode)).toBe(expected);
    });
  });
});
