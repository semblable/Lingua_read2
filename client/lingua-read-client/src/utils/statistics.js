const pick = (obj, ...keys) => {
  if (!obj) return undefined;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
};

const numberOrZero = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const normalizeLanguageStatistics = (language = {}) => {
  const languageId = pick(language, 'languageId', 'LanguageId');

  return {
    languageId,
    languageName: pick(language, 'languageName', 'LanguageName') || 'Unknown',
    languageCode: pick(language, 'languageCode', 'LanguageCode') || '',
    wordCount: numberOrZero(pick(language, 'wordCount', 'WordCount')),
    knownWords: numberOrZero(pick(language, 'knownWords', 'KnownWords')),
    learningWords: numberOrZero(pick(language, 'learningWords', 'LearningWords')),
    totalWordsRead: numberOrZero(pick(language, 'totalWordsRead', 'TotalWordsRead')),
    totalTextsCompleted: numberOrZero(pick(language, 'totalTextsCompleted', 'TotalTextsCompleted')),
    totalSecondsListened: numberOrZero(pick(language, 'totalSecondsListened', 'TotalSecondsListened')),
    bookCount: numberOrZero(pick(language, 'bookCount', 'BookCount')),
    finishedBookCount: numberOrZero(pick(language, 'finishedBookCount', 'FinishedBookCount')),
    cefrLevel: pick(language, 'cefrLevel', 'CefrLevel') || null,
    nextCefrLevel: pick(language, 'nextCefrLevel', 'NextCefrLevel') || null,
    knownWordsToNextLevel: numberOrZero(pick(language, 'knownWordsToNextLevel', 'KnownWordsToNextLevel')),
    bandProgressPercent: numberOrZero(pick(language, 'bandProgressPercent', 'BandProgressPercent')),
    isCefrApproximate: Boolean(pick(language, 'isCefrApproximate', 'IsCefrApproximate'))
  };
};

export const normalizeStatistics = (stats = {}) => {
  const languageStatistics = pick(stats, 'languageStatistics', 'LanguageStatistics') || [];

  return {
    totalWords: numberOrZero(pick(stats, 'totalWords', 'TotalWords')),
    knownWords: numberOrZero(pick(stats, 'knownWords', 'KnownWords')),
    learningWords: numberOrZero(pick(stats, 'learningWords', 'LearningWords')),
    totalBooks: numberOrZero(pick(stats, 'totalBooks', 'TotalBooks')),
    finishedBooks: numberOrZero(pick(stats, 'finishedBooks', 'FinishedBooks')),
    lastActivity: pick(stats, 'lastActivity', 'LastActivity') || null,
    totalLanguages: numberOrZero(pick(stats, 'totalLanguages', 'TotalLanguages')),
    languageStatistics: Array.isArray(languageStatistics)
      ? languageStatistics.map(normalizeLanguageStatistics).filter((language) => {
        const id = language.languageId;
        return id !== undefined && id !== null && id !== 0 && id !== '0';
      })
      : []
  };
};

const normalizeActivityByDate = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => ({
        date: pick(item, 'date', 'Date'),
        value: numberOrZero(pick(item, 'value', 'Value', 'count', 'Count', 'wordCount', 'WordCount', 'totalSeconds', 'TotalSeconds'))
      }))
      .filter((item) => item.date);
  }

  return Object.entries(value).map(([date, count]) => ({
    date,
    value: numberOrZero(count)
  }));
};

const normalizeReadingLanguage = (language = {}) => ({
  languageId: pick(language, 'languageId', 'LanguageId'),
  languageName: pick(language, 'languageName', 'LanguageName', 'name', 'Name') || 'Unknown',
  totalWords: numberOrZero(pick(language, 'totalWords', 'TotalWords', 'wordCount', 'WordCount'))
});

const normalizeListeningLanguage = (language = {}) => ({
  languageId: pick(language, 'languageId', 'LanguageId'),
  languageName: pick(language, 'languageName', 'LanguageName', 'name', 'Name') || 'Unknown',
  totalSeconds: numberOrZero(pick(language, 'totalSeconds', 'TotalSeconds'))
});

export const normalizeReadingActivity = (activity = {}) => {
  const rawByLanguage = pick(activity, 'activityByLanguage', 'ActivityByLanguage') || [];
  const activityByLanguage = Array.isArray(rawByLanguage)
    ? rawByLanguage.map(normalizeReadingLanguage)
    : Object.entries(rawByLanguage).map(([languageName, totalWords]) => ({
      languageId: null,
      languageName,
      totalWords: numberOrZero(totalWords)
    }));

  return {
    totalWordsRead: numberOrZero(pick(activity, 'totalWordsRead', 'TotalWordsRead')),
    activityByDate: normalizeActivityByDate(pick(activity, 'activityByDate', 'ActivityByDate'))
      .map((item) => ({ date: item.date, wordsRead: item.value }))
      .sort((a, b) => new Date(a.date) - new Date(b.date)),
    activityByLanguage
  };
};

export const normalizeListeningActivity = (activity = {}) => {
  const rawByLanguage = pick(activity, 'listeningByLanguage', 'ListeningByLanguage') || [];

  return {
    totalListeningSeconds: numberOrZero(pick(activity, 'totalListeningSeconds', 'TotalListeningSeconds')),
    listeningByDate: normalizeActivityByDate(pick(activity, 'listeningByDate', 'ListeningByDate'))
      .map((item) => ({ date: item.date, minutesListened: Math.round(item.value / 60) }))
      .sort((a, b) => new Date(a.date) - new Date(b.date)),
    listeningByLanguage: Array.isArray(rawByLanguage)
      ? rawByLanguage.map(normalizeListeningLanguage)
      : []
  };
};

export const formatDuration = (totalSeconds) => {
  const secondsTotal = numberOrZero(totalSeconds);
  if (secondsTotal === 0) return '0m';

  const hours = Math.floor(secondsTotal / 3600);
  const minutes = Math.floor((secondsTotal % 3600) / 60);
  const seconds = secondsTotal % 60;

  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
};

export const periodDayCount = (period) => {
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

export const supportsPreviousPeriod = (period) => periodDayCount(period) !== null;

export const previousPeriodLabel = (period) => {
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

export const computeDelta = (current, previous) => {
  const cur = numberOrZero(current);
  const prev = numberOrZero(previous);
  if (prev === 0) return null;
  const diff = cur - prev;
  const pct = Math.round((diff / prev) * 100);
  let direction = 'flat';
  if (diff > 0) direction = 'up';
  else if (diff < 0) direction = 'down';
  return { diff, pct, direction, previous: prev };
};

export const buildLanguageStats = ({ stats, readingActivity, listeningActivity, period }) => {
  const languages = new Map();

  const ensureLanguage = ({ languageId, languageName }) => {
    if (languageId === undefined || languageId === null || languageId === 0 || languageId === '0') {
      return null;
    }
    const key = String(languageId);
    if (!languages.has(key)) {
      languages.set(key, {
        languageId,
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
        isCefrApproximate: false
      });
    }
    return languages.get(key);
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
    .map((language) => ({
      ...language,
      displayWordsRead: period === 'all' ? language.totalWordsRead : language.periodWordsRead,
      displaySecondsListened: period === 'all' ? language.totalSecondsListened : language.periodSecondsListened
    }))
    .sort((a, b) => a.languageName.localeCompare(b.languageName));
};

export const getDisplayStats = ({ stats, languages, selectedLanguage }) => {
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

