import type { Dashboard } from '../src/utils/api/stats';
import type { RecentTexts, Text, TextsList } from '../src/utils/api/texts';
import type { GoalSuggestion } from '../src/utils/api/goals';
import type { LanguagesList } from '../src/utils/api/languages';

// Wholly authored fixtures. Never derive these from a personal library or HAR.
export const longTitle = 'Éloïse écoute la rivière : une promenade à travers les jardins, les villages et les collines après la pluie';
export const unbrokenTerm = 'Donaudampfschifffahrtsgesellschaftskapitänsprüfungsvorbereitungsheft';

export const audioLesson: RecentTexts[number] = {
  textId: 701,
  title: longTitle,
  languageName: 'Français',
  lastAccessedAt: '2026-11-12T10:55:00Z',
  isAudioLesson: true,
  totalWords: 1200,
  knownWords: 1080,
  preview: `À l’aube, Éloïse prépare du café. Un carnet porte le mot ${unbrokenTerm}. Elle sourit et reprend sa promenade.`,
  audioPositionSeconds: 180,
  audioDurationSeconds: 900,
};

export const readingLesson: RecentTexts[number] = {
  textId: 702,
  title: `${unbrokenTerm} : notes d’un voyage à vélo`,
  languageName: 'Français',
  lastAccessedAt: '2026-11-12T10:30:00Z',
  totalWords: 1800,
  knownWords: 1620,
  readWords: 320,
  preview: 'Après le marché, la voyageuse suit un chemin tranquille jusqu’à la forêt.',
};

// No title, language, cover, preview, progress, or book information. A legacy
// summary without totalWords also exercises the real detail-enrichment request.
export const sparseLesson: RecentTexts[number] = { textId: 703 };
export const sparseDetail: Text = { textId: 703, title: '', content: '', languageId: 21 };

export const recommendations: TextsList = [{
  textId: 704,
  title: 'Le marché des petites découvertes',
  languageName: 'Français',
  totalWords: 1000,
  knownWords: 900,
  unknownWords: 100,
}];

export const dashboard: Dashboard = {
  totalKnownWords: 1480,
  totalWordsReadWeek: 4200,
  totalListeningSecondsWeek: 1200,
  totalLanguages: 2,
  languages: [{
    languageId: 21,
    languageName: 'Français',
    knownWords: 1200,
    totalWords: 2200,
    cefrLevel: 'A2',
    nextCefrLevel: 'B1',
    knownWordsToNextLevel: 800,
    bandProgressPercent: 60,
    todayWordsRead: 320,
    todayListeningSeconds: 180,
    currentReadingStreakDays: 4,
    lastActivityAt: '2026-11-12T10:55:00Z',
    continueReadingTextId: 702,
    last14DaysWords: [{ date: '2026-11-11', count: 500 }, { date: '2026-11-12', count: 320 }],
  }, {
    languageId: 22,
    languageName: 'Español',
    knownWords: 280,
    totalWords: 600,
    todayWordsRead: 0,
    todayListeningSeconds: 0,
    currentReadingStreakDays: 0,
  }],
};

export const languages: LanguagesList = [
  { languageId: 21, name: 'Français', code: 'fr' },
  { languageId: 22, name: 'Español', code: 'es' },
].map(language => ({
  ...language,
  showRomanization: false,
  rightToLeft: false,
  parserType: 'spacedel',
  splitSentences: '.!?',
  wordCharacters: 'a-zA-ZÀ-ÿ',
  isActiveForTranslation: true,
}));

export const goalSuggestion: GoalSuggestion = {
  suggestedTarget: 1000,
  currentMetric: 1200,
  last7DaysTotal: 0,
  last30DaysTotal: 0,
};
