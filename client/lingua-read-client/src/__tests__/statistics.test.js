import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import StatsFilters from '../components/statistics/StatsFilters';
import LanguageStatsSection from '../components/statistics/LanguageStatsSection';
import {
  buildLanguageStats,
  getDisplayStats,
  normalizeListeningActivity,
  normalizeReadingActivity,
  normalizeStatistics,
  periodDayCount
} from '../utils/statistics';

describe('statistics normalizers', () => {
  test('normalizes mixed-case user statistics without mutating the response shape', () => {
    const normalized = normalizeStatistics({
      TotalWords: 100,
      knownWords: 45,
      LearningWords: 55,
      TotalBooks: 3,
      finishedBooks: 1,
      LanguageStatistics: [
        {
          LanguageId: 2,
          LanguageName: 'Spanish',
          WordCount: 100,
          KnownWords: 45,
          TotalWordsRead: 1200,
          TotalSecondsListened: 600
        }
      ]
    });

    expect(normalized.totalWords).toBe(100);
    expect(normalized.knownWords).toBe(45);
    expect(normalized.languageStatistics[0]).toMatchObject({
      languageId: 2,
      languageName: 'Spanish',
      wordCount: 100,
      totalWordsRead: 1200,
      totalSecondsListened: 600
    });
  });

  test('normalizes old and new reading activity language shapes', () => {
    const oldShape = normalizeReadingActivity({
      TotalWordsRead: 300,
      ActivityByDate: { '2026-04-29': 300 },
      ActivityByLanguage: { French: 300 }
    });
    const newShape = normalizeReadingActivity({
      totalWordsRead: 500,
      activityByLanguage: [{ languageId: 1, languageName: 'French', totalWords: 500 }]
    });

    expect(oldShape.activityByDate).toEqual([{ date: '2026-04-29', wordsRead: 300 }]);
    expect(oldShape.activityByLanguage[0]).toMatchObject({ languageName: 'French', totalWords: 300 });
    expect(newShape.activityByLanguage[0]).toMatchObject({ languageId: 1, totalWords: 500 });
  });

  test('builds language display stats from cumulative and period activity', () => {
    const stats = normalizeStatistics({
      languageStatistics: [{
        languageId: 1,
        languageName: 'French',
        wordCount: 1000,
        knownWords: 400,
        learningWords: 600,
        totalWordsRead: 10000,
        totalSecondsListened: 3600
      }]
    });
    const readingActivity = normalizeReadingActivity({
      activityByLanguage: [{ languageId: 1, languageName: 'French', totalWords: 700 }]
    });
    const listeningActivity = normalizeListeningActivity({
      listeningByLanguage: [{ languageId: 1, languageName: 'French', totalSeconds: 900 }]
    });

    const periodLanguages = buildLanguageStats({ stats, readingActivity, listeningActivity, period: 'last_week' });
    const allTimeLanguages = buildLanguageStats({ stats, readingActivity, listeningActivity, period: 'all' });

    expect(periodLanguages[0]).toMatchObject({
      displayWordsRead: 700,
      displaySecondsListened: 900
    });
    expect(allTimeLanguages[0]).toMatchObject({
      displayWordsRead: 10000,
      displaySecondsListened: 3600
    });
    expect(getDisplayStats({ stats, languages: periodLanguages, selectedLanguage: 1 }).knownWords).toBe(400);
  });

  test('periodDayCount maps finite activity periods', () => {
    expect(periodDayCount('last_day')).toBe(1);
    expect(periodDayCount('last_week')).toBe(7);
    expect(periodDayCount('all')).toBeNull();
  });
});

describe('statistics components', () => {
  test('StatsFilters renders period and language controls', () => {
    render(
      <StatsFilters
        activityPeriod="last_week"
        selectedLanguage="all"
        languages={[{ languageId: 1, languageName: 'French' }]}
        onPeriodChange={() => {}}
        onLanguageChange={() => {}}
        onLogActivity={() => {}}
      />
    );

    expect(screen.getByLabelText(/select activity period/i)).toHaveValue('last_week');
    expect(screen.getByLabelText(/select language/i)).toHaveValue('all');
    expect(screen.getByText('French')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log activity/i })).toBeInTheDocument();
  });

  test('LanguageStatsSection renders an explicit empty state', () => {
    render(<LanguageStatsSection languages={[]} loadingActivity={false} />);

    expect(screen.getByText(/No language-specific data available yet/i)).toBeInTheDocument();
  });
});

