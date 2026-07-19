import React from 'react';
import { Button, Form } from 'react-bootstrap';
import type { LanguageStatsRow } from '../../utils/statistics';

interface PeriodOption {
  value: string;
  label: string;
}

const ACTIVITY_PERIODS: PeriodOption[] = [
  { value: 'last_day', label: 'Today' },
  { value: 'last_week', label: 'Last 7 Days' },
  { value: 'last_month', label: 'Last 30 Days' },
  { value: 'last_90', label: '90 Days' },
  { value: 'last_180', label: '180 Days' },
  { value: 'all', label: 'All Time' }
];

interface StatsFiltersProps {
  activityPeriod: string;
  selectedLanguage: string | number;
  languages: LanguageStatsRow[];
  onPeriodChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onLogActivity: () => void;
}

const StatsFilters = ({
  activityPeriod,
  selectedLanguage,
  languages,
  onPeriodChange,
  onLanguageChange,
  onLogActivity
}: StatsFiltersProps) => (
  <div className="stats-filter-bar">
    <Form.Select
      className="stats-filter-select fw-medium"
      value={activityPeriod}
      onChange={(event) => onPeriodChange(event.target.value)}
      aria-label="Select activity period"
    >
      {ACTIVITY_PERIODS.map((period: PeriodOption) => (
        <option key={period.value} value={period.value}>
          {period.label}
        </option>
      ))}
    </Form.Select>

    <Form.Select
      className="stats-filter-select fw-medium"
      value={selectedLanguage}
      onChange={(event) => onLanguageChange(event.target.value)}
      disabled={languages.length === 0}
      aria-label="Select language"
    >
      <option value="all">All Languages</option>
      {languages.map((language: LanguageStatsRow) => (
        <option key={language.languageId} value={language.languageId}>
          {language.languageName}
        </option>
      ))}
    </Form.Select>

    <Button className="rounded-pill px-4" onClick={onLogActivity}>
      Log Activity
    </Button>
  </div>
);

export default StatsFilters;

