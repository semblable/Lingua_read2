import type { LanguageInput } from './api/languages';
import { DEFAULT_LANGUAGE_WORD_CHARACTERS } from './readerText';

export interface LanguagePreset {
  code: string;
  name: string;
  nativeName: string;
  country: string;
  flag: string;
  rightToLeft?: boolean;
  splitSentences?: string;
  parserType?: string;
  limitedWordSplitting?: boolean;
}

// Suggestions only: importing the catalog never creates database records or
// changes the starter languages. Flags are bundled flag-icons SVGs.
export const LANGUAGE_PRESETS: readonly LanguagePreset[] = [
  { code: 'af', name: 'Afrikaans', nativeName: 'Afrikaans', country: 'South Africa', flag: 'za' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', country: 'Saudi Arabia', flag: 'sa', rightToLeft: true, splitSentences: '.!?؟' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', country: 'Bangladesh', flag: 'bd', splitSentences: '.!?।' },
  { code: 'bg', name: 'Bulgarian', nativeName: 'Български', country: 'Bulgaria', flag: 'bg' },
  { code: 'ca', name: 'Catalan', nativeName: 'Català', country: 'Catalonia', flag: 'es-ct' },
  { code: 'zh', name: 'Chinese', nativeName: '中文', country: 'China', flag: 'cn', splitSentences: '.!?。！？', parserType: 'jieba', limitedWordSplitting: true },
  { code: 'hr', name: 'Croatian', nativeName: 'Hrvatski', country: 'Croatia', flag: 'hr' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština', country: 'Czechia', flag: 'cz' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk', country: 'Denmark', flag: 'dk' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', country: 'Netherlands', flag: 'nl' },
  { code: 'en', name: 'English', nativeName: 'English', country: 'United Kingdom', flag: 'gb' },
  { code: 'et', name: 'Estonian', nativeName: 'Eesti', country: 'Estonia', flag: 'ee' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi', country: 'Finland', flag: 'fi' },
  { code: 'fr', name: 'French', nativeName: 'Français', country: 'France', flag: 'fr' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', country: 'Germany', flag: 'de' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά', country: 'Greece', flag: 'gr', splitSentences: '.!?;;' },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית', country: 'Israel', flag: 'il', rightToLeft: true },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', country: 'India', flag: 'in', splitSentences: '.!?।॥' },
  { code: 'hu', name: 'Hungarian', nativeName: 'Magyar', country: 'Hungary', flag: 'hu' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', country: 'Indonesia', flag: 'id' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', country: 'Italy', flag: 'it' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', country: 'Japan', flag: 'jp', splitSentences: '.!?。！？', parserType: 'mecab', limitedWordSplitting: true },
  { code: 'ko', name: 'Korean', nativeName: '한국어', country: 'South Korea', flag: 'kr', splitSentences: '.!?。！？' },
  { code: 'lv', name: 'Latvian', nativeName: 'Latviešu', country: 'Latvia', flag: 'lv' },
  { code: 'lt', name: 'Lithuanian', nativeName: 'Lietuvių', country: 'Lithuania', flag: 'lt' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu', country: 'Malaysia', flag: 'my' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk', country: 'Norway', flag: 'no' },
  { code: 'fa', name: 'Persian', nativeName: 'فارسی', country: 'Iran', flag: 'ir', rightToLeft: true, splitSentences: '.!?؟' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', country: 'Poland', flag: 'pl' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', country: 'Portugal', flag: 'pt' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română', country: 'Romania', flag: 'ro' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', country: 'Russia', flag: 'ru' },
  { code: 'sr', name: 'Serbian', nativeName: 'Српски', country: 'Serbia', flag: 'rs' },
  { code: 'sk', name: 'Slovak', nativeName: 'Slovenčina', country: 'Slovakia', flag: 'sk' },
  { code: 'sl', name: 'Slovenian', nativeName: 'Slovenščina', country: 'Slovenia', flag: 'si' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', country: 'Spain', flag: 'es' },
  { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili', country: 'Tanzania', flag: 'tz' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', country: 'Sweden', flag: 'se' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', country: 'India', flag: 'in', splitSentences: '.!?।' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย', country: 'Thailand', flag: 'th', limitedWordSplitting: true },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', country: 'Türkiye Turkey', flag: 'tr' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', country: 'Ukraine', flag: 'ua' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو', country: 'Pakistan', flag: 'pk', rightToLeft: true, splitSentences: '.!?؟۔' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', country: 'Vietnam', flag: 'vn' },
];

// Regional variants and legacy ISO codes match a base preset without changing
// the user's saved code or settings.
export function baseLanguageCode(code: string): string {
  const base = code.trim().toLowerCase().replace(/_/g, '-').split('-')[0];
  if (base === 'iw') return 'he';
  if (base === 'in') return 'id';
  if (base === 'nb' || base === 'nn') return 'no';
  return base;
}

export function findLanguagePreset(code: string): LanguagePreset | undefined {
  return LANGUAGE_PRESETS.find(preset => preset.code === baseLanguageCode(code));
}

export function languagePresetInput(preset: LanguagePreset): LanguageInput {
  return {
    name: preset.name,
    code: preset.code,
    showRomanization: false,
    rightToLeft: preset.rightToLeft ?? false,
    parserType: preset.parserType ?? 'spacedel',
    characterSubstitutions: '',
    splitSentences: preset.splitSentences ?? '.!?',
    // Include joiners used within words in Persian, Urdu and Indic scripts.
    wordCharacters: DEFAULT_LANGUAGE_WORD_CHARACTERS + String.raw`\u200C\u200D`,
    isActiveForTranslation: true,
    dictionaries: [],
    sentenceSplitExceptions: [],
  };
}
