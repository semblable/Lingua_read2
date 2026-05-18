import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import StatsFilters from '../components/statistics/StatsFilters';
import LanguageStatsSection from '../components/statistics/LanguageStatsSection';
import StatCard from '../components/statistics/StatCard';
import ActivityHeatmap from '../components/statistics/ActivityHeatmap';
import MilestoneCards from '../components/statistics/MilestoneCards';
import {
  buildLanguageStats,
  computeDelta,
  getDisplayStats,
  normalizeListeningActivity,
  normalizeReadingActivity,
  normalizeStatistics,
  periodDayCount,
  previousPeriodLabel,
  supportsPreviousPeriod
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

  test('LanguageStatsSection cards trigger drill-down when clicked', () => {
    const onSelect = vi.fn();
    render(
      <LanguageStatsSection
        languages={[{
          languageId: 7,
          languageName: 'Italian',
          totalWordsEncountered: 100,
          knownWords: 30,
          learningWords: 50,
          totalWordsRead: 0,
          totalSecondsListened: 0,
          totalTextsCompleted: 0,
          bookCount: 1,
          finishedBookCount: 0,
          displayWordsRead: 0,
          displaySecondsListened: 0,
          cefrLevel: null,
          isCefrApproximate: false
        }]}
        loadingActivity={false}
        selectedLanguageId="all"
        onSelectLanguage={onSelect}
      />
    );

    fireEvent.click(screen.getByText('Italian').closest('[role="button"]'));
    expect(onSelect).toHaveBeenCalledWith('7');
  });
});

describe('trend delta helpers', () => {
  test('computeDelta returns positive direction for growth', () => {
    expect(computeDelta(120, 100)).toMatchObject({ diff: 20, pct: 20, direction: 'up' });
  });

  test('computeDelta returns negative direction for decline', () => {
    expect(computeDelta(80, 100)).toMatchObject({ diff: -20, pct: -20, direction: 'down' });
  });

  test('computeDelta returns null when previous baseline is zero or missing', () => {
    expect(computeDelta(50, 0)).toBeNull();
    expect(computeDelta(50, null)).toBeNull();
  });

  test('computeDelta returns flat for unchanged values', () => {
    expect(computeDelta(50, 50)).toMatchObject({ diff: 0, pct: 0, direction: 'flat' });
  });

  test('previousPeriodLabel maps known periods', () => {
    expect(previousPeriodLabel('last_week')).toBe('vs previous 7 days');
    expect(previousPeriodLabel('last_month')).toBe('vs previous 30 days');
    expect(previousPeriodLabel('all')).toBe('');
  });

  test('supportsPreviousPeriod returns false for "all"', () => {
    expect(supportsPreviousPeriod('all')).toBe(false);
    expect(supportsPreviousPeriod('last_week')).toBe(true);
  });
});

describe('StatCard delta rendering', () => {
  test('renders delta badge when delta prop provided', () => {
    render(
      <StatCard
        title="Words Read"
        value="100"
        delta={{ pct: 25, direction: 'up', label: 'vs previous 7 days' }}
      />
    );

    expect(screen.getByText('+25%')).toBeInTheDocument();
    expect(screen.getByText(/vs previous 7 days/)).toBeInTheDocument();
  });

  test('omits delta when null', () => {
    render(<StatCard title="Words Read" value="100" />);
    expect(screen.queryByText(/%/)).toBeNull();
  });
});

describe('ActivityHeatmap', () => {
  test('renders empty state without activity', () => {
    render(
      <ActivityHeatmap
        readingActivity={{ activityByDate: [] }}
        listeningActivity={{ listeningByDate: [] }}
        period="last_week"
      />
    );

    expect(screen.getByText(/No activity in last/i)).toBeInTheDocument();
  });

  test('toggles between reading and listening modes', () => {
    render(
      <ActivityHeatmap
        readingActivity={{ activityByDate: [] }}
        listeningActivity={{ listeningByDate: [] }}
        period="last_week"
      />
    );

    const listeningToggle = screen.getByRole('radio', { name: /listening/i });
    fireEvent.click(listeningToggle);
    expect(listeningToggle).toBeChecked();
  });

  test('uses period day count for cell count when >= 7', () => {
    const { container } = render(
      <ActivityHeatmap
        readingActivity={{ activityByDate: [] }}
        listeningActivity={{ listeningByDate: [] }}
        period="last_week"
      />
    );
    expect(container.querySelectorAll('[role="gridcell"]').length).toBe(7);
  });
});

describe('MilestoneCards', () => {
  const languages = [
    {
      languageId: 1,
      languageName: 'French',
      cefrLevel: 'B1',
      nextCefrLevel: 'B2',
      knownWordsToNextLevel: 1500,
      bandProgressPercent: 60,
      isCefrApproximate: false
    },
    {
      languageId: 2,
      languageName: 'Spanish',
      cefrLevel: 'A2',
      nextCefrLevel: 'B1',
      knownWordsToNextLevel: 600,
      bandProgressPercent: 80,
      isCefrApproximate: false
    },
    {
      languageId: 3,
      languageName: 'Latin',
      cefrLevel: null,
      nextCefrLevel: null,
      knownWordsToNextLevel: 0,
      bandProgressPercent: 0,
      isCefrApproximate: false
    }
  ];

  test('shows the focused language card when selected', () => {
    render(<MilestoneCards languages={languages} selectedLanguage="1" />);
    expect(screen.getByText('French')).toBeInTheDocument();
    expect(screen.queryByText('Spanish')).toBeNull();
  });

  test('shows top languages by progress when "all" is selected', () => {
    render(<MilestoneCards languages={languages} selectedLanguage="all" />);
    expect(screen.getByText('Spanish')).toBeInTheDocument();
    expect(screen.getByText('French')).toBeInTheDocument();
    expect(screen.queryByText('Latin')).toBeNull();
  });

  test('returns nothing when no language has a next level', () => {
    const { container } = render(
      <MilestoneCards
        languages={[{ ...languages[2] }]}
        selectedLanguage="all"
      />
    );
    expect(container.firstChild).toBeNull();
  });
});

