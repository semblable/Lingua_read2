import { describe, it, expect } from 'vitest';
import {
  tokenizeContent,
  extractWords,
  lowercaseLookupTerm,
  stripLookupDiacritics,
  splitSentenceAroundTerm,
  sentenceContainsTerm,
  pickSentenceForTerm,
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

      expect(wordsOf(input, ar)).toEqual(['كَتَبَ', 'الطَّالِبُ', 'كِتَابًا', 'فِي', 'عَامِ', '2026', 'وَقَالَتْ', 'مَرْحَبًا']);
      expect(lookupKeysOf(input, ar)).toEqual(['كتب', 'الطالب', 'كتابا', 'في', 'عام', '2026', 'وقالت', 'مرحبا']);

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

      expect(wordsOf(input, he)).toEqual(['הַאִם', 'קָרָאתָ', 'אֶת', 'הַדּוּ״חַ', 'שֶׁל', 'צה״ל', 'בְּ', '2026']);
      expect(lookupKeysOf(input, he)).toEqual(['האם', 'קראת', 'את', 'הדו״ח', 'של', 'צה״ל', 'ב', '2026']);

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
      expect(lookupKeysOf(input2, he)).toEqual(['הדו״ח', 'של', 'צה״ל']);
      expect(lowercaseLookupTerm('צה"ל', 'he')).toBe('צה״ל');
      expect(lowercaseLookupTerm('צה״ל', 'he')).toBe('צה״ל');
      expect(lowercaseLookupTerm("תנ'ך", 'he')).toBe('תנ׳ך');
      expect(lowercaseLookupTerm('תנ׳ך', 'he')).toBe('תנ׳ך');

      // Hebrew Geresh inside acronym
      const input3 = 'תנ״ך וגב׳ כהן';
      const words3 = wordsOf(input3, he);
      expect(words3[0]).toBe('תנ״ך');
    });

    it('preserves Indic vowel marks (never strips Mn globally)', () => {
      expect(stripLookupDiacritics('किताब', 'hi')).toBe('किताब');
      expect(lowercaseLookupTerm('किताब', 'hi')).toBe('किताब');
      expect(lowercaseLookupTerm('বই', 'bn')).toBe('বই');
      expect(lowercaseLookupTerm('தமிழ்', 'ta')).toBe('தமிழ்');
    });

    it('trims leading and trailing ZWNJ/ZWJ while preserving internal joiners', () => {
      expect(lowercaseLookupTerm('می\u200Cروم', 'fa')).toBe('می\u200Cروم');
      expect(lowercaseLookupTerm('র\u200D্যাব', 'bn')).toBe('র\u200D্যাব');

      expect(lowercaseLookupTerm('\u200Cکتاب\u200C', 'fa')).toBe('کتاب');
      expect(lowercaseLookupTerm('\u200Dবই\u200D', 'bn')).toBe('বই');

      const words = wordsOf('کتاب\u200C نو', { code: 'fa', wordCharacters: '\\p{L}\\p{M}\\u200C\\u200D', characterSubstitutions: '' });
      expect(words[0]).toBe('کتاب');
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

  describe('Sentence Highlighting, Cloze & Mining Parity (splitSentenceAroundTerm / sentenceContainsTerm / pickSentenceForTerm)', () => {
    it('Arabic: matches vocalized words, hamza-folded legacy keys, tatweel, and multi-word phrases while preserving raw diacritics', () => {
      const vocalizedSentence = 'هَلْ ذَهَبْتَ إِلَى الْمَكْتَبَةِ؟';
      expect(splitSentenceAroundTerm(vocalizedSentence, 'إلى', null, 'ar')).toEqual([
        { text: 'هَلْ ذَهَبْتَ ', isTerm: false },
        { text: 'إِلَى', isTerm: true },
        { text: ' الْمَكْتَبَةِ؟', isTerm: false },
      ]);
      expect(splitSentenceAroundTerm(vocalizedSentence, 'الى', null, 'ar')).toEqual([
        { text: 'هَلْ ذَهَبْتَ ', isTerm: false },
        { text: 'إِلَى', isTerm: true },
        { text: ' الْمَكْتَبَةِ؟', isTerm: false },
      ]);
      expect(splitSentenceAroundTerm(vocalizedSentence, 'إلى المكتبة', null, 'ar')).toEqual([
        { text: 'هَلْ ذَهَبْتَ ', isTerm: false },
        { text: 'إِلَى الْمَكْتَبَةِ', isTerm: true },
        { text: '؟', isTerm: false },
      ]);

      const tatweelSentence = 'ذَهَبْتُ إِلَى مَـكْـتَـبَـةِ الْمَدِينَةِ.';
      expect(splitSentenceAroundTerm(tatweelSentence, 'مكتبة', null, 'ar')).toEqual([
        { text: 'ذَهَبْتُ إِلَى ', isTerm: false },
        { text: 'مَـكْـتَـبَـةِ', isTerm: true },
        { text: ' الْمَدِينَةِ.', isTerm: false },
      ]);
      expect(sentenceContainsTerm(tatweelSentence, 'مكتبة', null, 'ar')).toBe(true);
      expect(pickSentenceForTerm('إلى', ['جُمْلَةٌ أُخْرَى.', vocalizedSentence], null, 'ar')).toBe(vocalizedSentence);
      expect(pickSentenceForTerm('الى', ['جُمْلَةٌ أُخْرَى.', vocalizedSentence], null, 'ar')).toBe(vocalizedSentence);
    });

    it('Persian & Urdu: matches vocalized words while preserving raw text', () => {
      const faSentence = 'او ۴۵٬۰۰۰ ریال برایِ خانهٔ نو داد.';
      expect(splitSentenceAroundTerm(faSentence, 'خانه', null, 'fa')).toEqual([
        { text: 'او ۴۵٬۰۰۰ ریال برایِ ', isTerm: false },
        { text: 'خانهٔ', isTerm: true },
        { text: ' نو داد.', isTerm: false },
      ]);
      const urSentence = 'اُس نے کہا: ”پڑھائی مکمل ہوئی۔“';
      expect(sentenceContainsTerm(urSentence, 'اس', null, 'ur')).toBe(true);
      expect(pickSentenceForTerm('اس', [null, urSentence], null, 'ur')).toBe(urSentence);
    });

    it('Hebrew: matches vocalized words, ASCII-quote acronyms, and proclitics while preserving raw spans', () => {
      const heSentence = 'הַאִם קָרָאתָ אֶת הַדּוּ״חַ שֶׁל צה"ל?';
      expect(splitSentenceAroundTerm(heSentence, 'קראת', null, 'he')).toEqual([
        { text: 'הַאִם ', isTerm: false },
        { text: 'קָרָאתָ', isTerm: true },
        { text: ' אֶת הַדּוּ״חַ שֶׁל צה"ל?', isTerm: false },
      ]);
      expect(splitSentenceAroundTerm(heSentence, 'צה״ל', null, 'he')).toEqual([
        { text: 'הַאִם קָרָאתָ אֶת הַדּוּ״חַ שֶׁל ', isTerm: false },
        { text: 'צה"ל', isTerm: true },
        { text: '?', isTerm: false },
      ]);
      expect(splitSentenceAroundTerm('קָרָאתִי וְהַסֵּפֶר הָיָה טוֹב.', 'ספר', null, 'he')).toEqual([
        { text: 'קָרָאתִי ', isTerm: false },
        { text: 'וְהַסֵּפֶר', isTerm: true },
        { text: ' הָיָה טוֹב.', isTerm: false },
      ]);
      expect(sentenceContainsTerm(heSentence, 'צה״ל', null, 'he')).toBe(true);
      expect(pickSentenceForTerm('קראת', ['משפט אחר.', heSentence], null, 'he')).toBe(heSentence);
    });

    it('Russian, Ukrainian & Lithuanian: matches stressed and accented words without detaching combining marks', () => {
      const ruSentence = 'Я пью молоко\u0301 каждый день.';
      expect(splitSentenceAroundTerm(ruSentence, 'молоко', null, 'ru')).toEqual([
        { text: 'Я пью ', isTerm: false },
        { text: 'молоко\u0301', isTerm: true },
        { text: ' каждый день.', isTerm: false },
      ]);
      expect(sentenceContainsTerm(ruSentence, 'молоко', null, 'ru')).toBe(true);
      expect(pickSentenceForTerm('молоко', ['Другое предложение.', ruSentence], null, 'ru')).toBe(ruSentence);

      const ukSentence = "У мене є п'я\u0301ть книг.";
      expect(splitSentenceAroundTerm(ukSentence, "п'ять", null, 'uk')).toEqual([
        { text: 'У мене є ', isTerm: false },
        { text: "п'я\u0301ть", isTerm: true },
        { text: ' книг.', isTerm: false },
      ]);
      expect(sentenceContainsTerm(ukSentence, "п'ять", null, 'uk')).toBe(true);
      expect(pickSentenceForTerm("п'ять", ['Інше речення.', ukSentence], null, 'uk')).toBe(ukSentence);

      const ltSentence = 'Jis ė\u0301jo namo.';
      expect(splitSentenceAroundTerm(ltSentence, 'ėjo', null, 'lt')).toEqual([
        { text: 'Jis ', isTerm: false },
        { text: 'ė\u0301jo', isTerm: true },
        { text: ' namo.', isTerm: false },
      ]);
      expect(sentenceContainsTerm(ltSentence, 'ėjo', null, 'lt')).toBe(true);
      expect(pickSentenceForTerm('ėjo', ['Kitas sakinys.', ltSentence], null, 'lt')).toBe(ltSentence);
    });

    it('Turkish & Greek: matches dotted/dotless I, all-caps Greek, and legacy v4 folded terms', () => {
      const trSentence = 'IŞIK ve İSTANBUL çok güzel.';
      expect(splitSentenceAroundTerm(trSentence, 'ışık', null, 'tr')).toEqual([
        { text: 'IŞIK', isTerm: true },
        { text: ' ve İSTANBUL çok güzel.', isTerm: false },
      ]);
      expect(splitSentenceAroundTerm(trSentence, 'istanbul', null, 'tr')).toEqual([
        { text: 'IŞIK ve ', isTerm: false },
        { text: 'İSTANBUL', isTerm: true },
        { text: ' çok güzel.', isTerm: false },
      ]);
      expect(pickSentenceForTerm('ışık', ['Başka cümle.', trSentence], null, 'tr')).toBe(trSentence);

      const elCapsSentence = 'Ο ΛΟΓΟΣ είναι απλός.';
      expect(splitSentenceAroundTerm(elCapsSentence, 'λόγος', null, 'el')).toEqual([
        { text: 'Ο ', isTerm: false },
        { text: 'ΛΟΓΟΣ', isTerm: true },
        { text: ' είναι απλός.', isTerm: false },
      ]);
      const elAccentedSentence = 'Ο λόγος είναι απλός.';
      expect(splitSentenceAroundTerm(elAccentedSentence, 'λογοσ', null, 'el')).toEqual([
        { text: 'Ο ', isTerm: false },
        { text: 'λόγος', isTerm: true },
        { text: ' είναι απλός.', isTerm: false },
      ]);
      expect(pickSentenceForTerm('λόγος', ['Άλλη πρόταση.', elCapsSentence], null, 'el')).toBe(elCapsSentence);
      expect(pickSentenceForTerm('λογοσ', ['Άλλη πρόταση.', elAccentedSentence], null, 'el')).toBe(elAccentedSentence);
    });
  });
});