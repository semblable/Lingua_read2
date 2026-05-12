// Public output shapes — consumers (Phase C3 useStatisticsData, statistics
// page components) import these. Inputs are intentionally typed as `unknown`
// because the API may return camelCase or PascalCase keys; the `pick` helper
// reconciles them.

export type LanguageStatistics = {
  languageId: string | number | undefined;
  languageName: string;
  languageCode: string;
  wordCount: number;
  knownWords: number;
  learningWords: number;
  totalWordsRead: number;
  totalTextsCompleted: number;
  totalSecondsListened: number;
  bookCount: number;
  finishedBookCount: number;
  cefrLevel: string | null;
  nextCefrLevel: string | null;
  knownWordsToNextLevel: number;
  bandProgressPercent: number;
  isCefrApproximate: boolean;
};

export type StatisticsSummary = {
  totalWords: number;
  knownWords: number;
  learningWords: number;
  totalBooks: number;
  finishedBooks: number;
  lastActivity: string | null;
  totalLanguages: number;
  languageStatistics: LanguageStatistics[];
};

export type ReadingActivityLanguage = {
  languageId: string | number | null | undefined;
  languageName: string;
  totalWords: number;
};

export type ReadingActivityPoint = { date: string; wordsRead: number };

export type ReadingActivity = {
  totalWordsRead: number;
  activityByDate: ReadingActivityPoint[];
  activityByLanguage: ReadingActivityLanguage[];
};

export type ListeningActivityLanguage = {
  languageId: string | number | undefined;
  languageName: string;
  totalSeconds: number;
};

export type ListeningActivityPoint = { date: string; minutesListened: number };

export type ListeningActivity = {
  totalListeningSeconds: number;
  listeningByDate: ListeningActivityPoint[];
  listeningByLanguage: ListeningActivityLanguage[];
};

export type KnownWordsActivityLanguage = {
  languageId: string | number | undefined;
  languageName: string;
  totalKnown: number;
};

export type KnownWordsActivityPoint = { date: string; knownWords: number };

export type KnownWordsActivity = {
  totalKnownWords: number;
  knownWordsByDate: KnownWordsActivityPoint[];
  knownWordsByLanguage: KnownWordsActivityLanguage[];
};

export type LanguageStatsRow = {
  languageId: string | number;
  languageName: string;
  languageCode: string;
  knownWords: number;
  learningWords: number;
  totalWordsEncountered: number;
  totalWordsRead: number;
  totalSecondsListened: number;
  totalTextsCompleted: number;
  bookCount: number;
  finishedBookCount: number;
  periodWordsRead: number;
  periodSecondsListened: number;
  cefrLevel: string | null;
  nextCefrLevel: string | null;
  knownWordsToNextLevel: number;
  bandProgressPercent: number;
  isCefrApproximate: boolean;
  displayWordsRead: number;
  displaySecondsListened: number;
};

export type DisplayStats = {
  totalWords: number;
  knownWords: number;
  learningWords: number;
  totalBooks: number;
  finishedBooks: number;
};

export type StatsDelta = {
  diff: number;
  pct: number;
  direction: 'up' | 'down' | 'flat';
  previous: number;
};

export type StatsPeriod = 'all' | 'last_day' | 'last_week' | 'last_month' | 'last_90' | 'last_180';

// --- helpers ---

const pick = (obj: unknown, ...keys: string[]): unknown => {
  if (!obj || typeof obj !== 'object') return undefined;
  const record = obj as Record<string, unknown>;
  for (const key of keys) {
    const v = record[key];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
};

const numberOrZero = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const stringOrEmpty = (value: unknown): string => (typeof value === 'string' ? value : '');

const normalizeLanguageStatistics = (language: unknown = {}): LanguageStatistics => {
  const languageId = pick(language, 'languageId', 'LanguageId') as string | number | undefined;

  return {
    languageId,
    languageName: stringOrEmpty(pick(language, 'languageName', 'LanguageName')) || 'Unknown',
    languageCode: stringOrEmpty(pick(language, 'languageCode', 'LanguageCode')),
    wordCount: numberOrZero(pick(language, 'wordCount', 'WordCount')),
    knownWords: numberOrZero(pick(language, 'knownWords', 'KnownWords')),
    learningWords: numberOrZero(pick(language, 'learningWords', 'LearningWords')),
    totalWordsRead: numberOrZero(pick(language, 'totalWordsRead', 'TotalWordsRead')),
    totalTextsCompleted: numberOrZero(pick(language, 'totalTextsCompleted', 'TotalTextsCompleted')),
    totalSecondsListened: numberOrZero(pick(language, 'totalSecondsListened', 'TotalSecondsListened')),
    bookCount: numberOrZero(pick(language, 'bookCount', 'BookCount')),
    finishedBookCount: numberOrZero(pick(language, 'finishedBookCount', 'FinishedBookCount')),
    cefrLevel: (pick(language, 'cefrLevel', 'CefrLevel') as string | null) || null,
    nextCefrLevel: (pick(language, 'nextCefrLevel', 'NextCefrLevel') as string | null) || null,
    knownWordsToNextLevel: numberOrZero(pick(language, 'knownWordsToNextLevel', 'KnownWordsToNextLevel')),
    bandProgressPercent: numberOrZero(pick(language, 'bandProgressPercent', 'BandProgressPercent')),
    isCefrApproximate: Boolean(pick(language, 'isCefrApproximate', 'IsCefrApproximate'))
  };
};

export const normalizeStatistics = (stats: unknown = {}): StatisticsSummary => {
  const languageStatistics = pick(stats, 'languageStatistics', 'LanguageStatistics');

  return {
    totalWords: numberOrZero(pick(stats, 'totalWords', 'TotalWords')),
    knownWords: numberOrZero(pick(stats, 'knownWords', 'KnownWords')),
    learningWords: numberOrZero(pick(stats, 'learningWords', 'LearningWords')),
    totalBooks: numberOrZero(pick(stats, 'totalBooks', 'TotalBooks')),
    finishedBooks: numberOrZero(pick(stats, 'finishedBooks', 'FinishedBooks')),
    lastActivity: (pick(stats, 'lastActivity', 'LastActivity') as string | null) || null,
    totalLanguages: numberOrZero(pick(stats, 'totalLanguages', 'TotalLanguages')),
    languageStatistics: Array.isArray(languageStatistics)
      ? languageStatistics.map(normalizeLanguageStatistics).filter((language) => {
          const id = language.languageId;
          return id !== undefined && id !== null && id !== 0 && id !== '0';
        })
      : []
  };
};

type RawDatedActivity = { date: string | undefined; value: number };

const normalizeActivityByDate = (value: unknown): RawDatedActivity[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item): RawDatedActivity => ({
        date: pick(
          item,
          'date',
          'Date'
        ) as string | undefined,
        value: numberOrZero(
          pick(item, 'value', 'Value', 'count', 'Count', 'wordCount', 'WordCount', 'totalSeconds', 'TotalSeconds')
        )
      }))
      .filter((item): item is RawDatedActivity & { date: string } => !!item.date);
  }

  return Object.entries(value as Record<string, unknown>).map(([date, count]) => ({
    date,
    value: numberOrZero(count)
  }));
};

const normalizeReadingLanguage = (language: unknown = {}): ReadingActivityLanguage => ({
  languageId: pick(language, 'languageId', 'LanguageId') as string | number | undefined,
  languageName:
    stringOrEmpty(pick(language, 'languageName', 'LanguageName', 'name', 'Name')) || 'Unknown',
  totalWords: numberOrZero(pick(language, 'totalWords', 'TotalWords', 'wordCount', 'WordCount'))
});

const normalizeListeningLanguage = (language: unknown = {}): ListeningActivityLanguage => ({
  languageId: pick(language, 'languageId', 'LanguageId') as string | number | undefined,
  languageName:
    stringOrEmpty(pick(language, 'languageName', 'LanguageName', 'name', 'Name')) || 'Unknown',
  totalSeconds: numberOrZero(pick(language, 'totalSeconds', 'TotalSeconds'))
});

export const normalizeReadingActivity = (activity: unknown = {}): ReadingActivity => {
  const rawByLanguage = pick(activity, 'activityByLanguage', 'ActivityByLanguage') ?? [];
  const activityByLanguage: ReadingActivityLanguage[] = Array.isArray(rawByLanguage)
    ? rawByLanguage.map(normalizeReadingLanguage)
    : Object.entries(rawByLanguage as Record<string, unknown>).map(
        ([languageName, totalWords]): ReadingActivityLanguage => ({
          languageId: null,
          languageName,
          totalWords: numberOrZero(totalWords)
        })
      );

  return {
    totalWordsRead: numberOrZero(pick(activity, 'totalWordsRead', 'TotalWordsRead')),
    activityByDate: normalizeActivityByDate(pick(activity, 'activityByDate', 'ActivityByDate'))
      .map((item): ReadingActivityPoint => ({ date: item.date as string, wordsRead: item.value }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    activityByLanguage
  };
};

export const normalizeListeningActivity = (activity: unknown = {}): ListeningActivity => {
  const rawByLanguage = pick(activity, 'listeningByLanguage', 'ListeningByLanguage') ?? [];

  return {
    totalListeningSeconds: numberOrZero(pick(activity, 'totalListeningSeconds', 'TotalListeningSeconds')),
    listeningByDate: normalizeActivityByDate(pick(activity, 'listeningByDate', 'ListeningByDate'))
      .map(
        (item): ListeningActivityPoint => ({
          date: item.date as string,
          minutesListened: Math.round(item.value / 60)
        })
      )
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    listeningByLanguage: Array.isArray(rawByLanguage) ? rawByLanguage.map(normalizeListeningLanguage) : []
  };
};

export const normalizeKnownWordsActivity = (activity: unknown = {}): KnownWordsActivity => {
  const rawByLanguage = pick(activity, 'knownWordsByLanguage', 'KnownWordsByLanguage') ?? [];

  return {
    totalKnownWords: numberOrZero(pick(activity, 'totalKnownWords', 'TotalKnownWords')),
    knownWordsByDate: normalizeActivityByDate(pick(activity, 'knownWordsByDate', 'KnownWordsByDate'))
      .map(
        (item): KnownWordsActivityPoint => ({
          date: item.date as string,
          knownWords: item.value
        })
      )
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    knownWordsByLanguage: Array.isArray(rawByLanguage)
      ? rawByLanguage.map(
          (language): KnownWordsActivityLanguage => ({
            languageId: pick(language, 'languageId', 'LanguageId') as string | number | undefined,
            languageName:
              stringOrEmpty(pick(language, 'languageName', 'LanguageName', 'name', 'Name')) || 'Unknown',
            totalKnown: numberOrZero(pick(language, 'totalKnown', 'TotalKnown'))
          })
        )
      : []
  };
};

export const toCumulative = <T extends Record<string, unknown>>(
  series: T[] | null | undefined,
  key: keyof T
): T[] => {
  if (!Array.isArray(series)) return [];
  let total = 0;
  return series.map((point) => {
    total += Number(point?.[key]) || 0;
    return { ...point, [key]: total } as T;
  });
};

export const formatDuration = (totalSeconds: number | null | undefined): string => {
  const secondsTotal = numberOrZero(totalSeconds);
  if (secondsTotal === 0) return '0m';

  const hours = Math.floor(secondsTotal / 3600);
  const minutes = Math.floor((secondsTotal % 3600) / 60);
  const seconds = secondsTotal % 60;

  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
};

export const periodDayCount = (period: StatsPeriod | string): number | null => {
  switch (period) {
    case 'last_day':
      return 1;
    case 'last_week':
      return 7;
    case 'last_month':
      return 30;
    case 'last_90':
      return 90;
    case 'last_180':
      return 180;
    default:
      return null;
  }
};

export const supportsPreviousPeriod = (period: StatsPeriod | string): boolean =>
  periodDayCount(period) !== null;

export const previousPeriodLabel = (period: StatsPeriod | string): string => {
  switch (period) {
    case 'last_day':
      return 'vs previous day';
    case 'last_week':
      return 'vs previous 7 days';
    case 'last_month':
      return 'vs previous 30 days';
    case 'last_90':
      return 'vs previous 90 days';
    case 'last_180':
      return 'vs previous 180 days';
    default:
      return '';
  }
};

export const computeDelta = (
  current: number | null | undefined,
  previous: number | null | undefined
): StatsDelta | null => {
  const cur = numberOrZero(current);
  const prev = numberOrZero(previous);
  if (prev === 0) return null;
  const diff = cur - prev;
  const pct = Math.round((diff / prev) * 100);
  let direction: StatsDelta['direction'] = 'flat';
  if (diff > 0) direction = 'up';
  else if (diff < 0) direction = 'down';
  return { diff, pct, direction, previous: prev };
};

type BuildLanguageStatsArgs = {
  stats: StatisticsSummary | null | undefined;
  readingActivity: ReadingActivity | null | undefined;
  listeningActivity: ListeningActivity | null | undefined;
  period: StatsPeriod | string;
};

export const buildLanguageStats = ({
  stats,
  readingActivity,
  listeningActivity,
  period
}: BuildLanguageStatsArgs): LanguageStatsRow[] => {
  const languages = new Map<string, LanguageStatsRow>();

  const ensureLanguage = ({
    languageId,
    languageName
  }: {
    languageId: string | number | null | undefined;
    languageName?: string;
  }): LanguageStatsRow | null => {
    if (languageId === undefined || languageId === null || languageId === 0 || languageId === '0') {
      return null;
    }
    const key = String(languageId);
    if (!languages.has(key)) {
      languages.set(key, {
        languageId: languageId as string | number,
        languageName: languageName || 'Unknown',
        languageCode: '',
        knownWords: 0,
        learningWords: 0,
        totalWordsEncountered: 0,
        totalWordsRead: 0,
        totalSecondsListened: 0,
        totalTextsCompleted: 0,
        bookCount: 0,
        finishedBookCount: 0,
        periodWordsRead: 0,
        periodSecondsListened: 0,
        cefrLevel: null,
        nextCefrLevel: null,
        knownWordsToNextLevel: 0,
        bandProgressPercent: 0,
        isCefrApproximate: false,
        displayWordsRead: 0,
        displaySecondsListened: 0
      });
    }
    return languages.get(key)!;
  };

  (stats?.languageStatistics || []).forEach((language) => {
    const entry = ensureLanguage(language);
    if (!entry) return;
    Object.assign(entry, {
      languageName: language.languageName,
      languageCode: language.languageCode,
      knownWords: language.knownWords,
      learningWords: language.learningWords,
      totalWordsEncountered: language.wordCount,
      totalWordsRead: language.totalWordsRead,
      totalSecondsListened: language.totalSecondsListened,
      totalTextsCompleted: language.totalTextsCompleted,
      bookCount: language.bookCount,
      finishedBookCount: language.finishedBookCount,
      cefrLevel: language.cefrLevel,
      nextCefrLevel: language.nextCefrLevel,
      knownWordsToNextLevel: language.knownWordsToNextLevel,
      bandProgressPercent: language.bandProgressPercent,
      isCefrApproximate: language.isCefrApproximate
    });
  });

  (readingActivity?.activityByLanguage || []).forEach((language) => {
    const entry = ensureLanguage(language);
    if (entry) entry.periodWordsRead = language.totalWords;
  });

  (listeningActivity?.listeningByLanguage || []).forEach((language) => {
    const entry = ensureLanguage(language);
    if (entry) entry.periodSecondsListened = language.totalSeconds;
  });

  return Array.from(languages.values())
    .map(
      (language): LanguageStatsRow => ({
        ...language,
        displayWordsRead: period === 'all' ? language.totalWordsRead : language.periodWordsRead,
        displaySecondsListened:
          period === 'all' ? language.totalSecondsListened : language.periodSecondsListened
      })
    )
    .sort((a, b) => a.languageName.localeCompare(b.languageName));
};

type GetDisplayStatsArgs = {
  stats: StatisticsSummary | null | undefined;
  languages: LanguageStatsRow[];
  selectedLanguage: string | number | 'all';
};

export const getDisplayStats = ({
  stats,
  languages,
  selectedLanguage
}: GetDisplayStatsArgs): DisplayStats => {
  if (selectedLanguage === 'all') {
    return {
      totalWords: stats?.totalWords || 0,
      knownWords: stats?.knownWords || 0,
      learningWords: stats?.learningWords || 0,
      totalBooks: stats?.totalBooks || 0,
      finishedBooks: stats?.finishedBooks || 0
    };
  }

  const language = languages.find((item) => String(item.languageId) === String(selectedLanguage));
  if (!language) return getDisplayStats({ stats, languages, selectedLanguage: 'all' });

  return {
    totalWords: language.totalWordsEncountered,
    knownWords: language.knownWords,
    learningWords: language.learningWords,
    totalBooks: language.bookCount,
    finishedBooks: language.finishedBookCount
  };
};
