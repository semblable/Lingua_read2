import React, { useMemo, useState } from 'react';
import { ButtonGroup, Card, ToggleButton } from 'react-bootstrap';
import { formatDuration, periodDayCount } from '../../utils/statistics';

const HEATMAP_FALLBACK_DAYS = 26 * 7;

const formatDateKey = (date) => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const generateDateRange = (numDays) => {
  const dates = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = numDays - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    dates.push(formatDateKey(d));
  }
  return dates;
};

const bucketIntensity = (value, max) => {
  if (!value || value <= 0) return 0;
  if (max <= 0) return 0;
  const ratio = value / max;
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.25) return 2;
  return 1;
};

const ActivityHeatmap = ({ readingActivity, listeningActivity, period }) => {
  const [mode, setMode] = useState('reading');

  const periodDays = periodDayCount(period);
  const numDays = periodDays && periodDays >= 7 ? periodDays : HEATMAP_FALLBACK_DAYS;

  const dateRange = useMemo(() => generateDateRange(numDays), [numDays]);

  const valueByDate = useMemo(() => {
    const map = new Map();
    if (mode === 'reading') {
      (readingActivity?.activityByDate || []).forEach((entry) => {
        if (entry?.date) map.set(entry.date, entry.wordsRead || 0);
      });
    } else {
      (listeningActivity?.listeningByDate || []).forEach((entry) => {
        if (entry?.date) map.set(entry.date, entry.minutesListened || 0);
      });
    }
    return map;
  }, [mode, readingActivity, listeningActivity]);

  const max = useMemo(() => {
    let m = 0;
    valueByDate.forEach((v) => {
      if (v > m) m = v;
    });
    return m;
  }, [valueByDate]);

  const totalActive = useMemo(() => {
    let count = 0;
    valueByDate.forEach((v) => {
      if (v > 0) count += 1;
    });
    return count;
  }, [valueByDate]);

  const formatValue = (value) => {
    if (mode === 'reading') return `${value.toLocaleString()} words`;
    return formatDuration(value * 60);
  };

  const summary = totalActive > 0
    ? `${totalActive} active day${totalActive === 1 ? '' : 's'} in last ${numDays} days`
    : `No activity in last ${numDays} days`;

  return (
    <Card className="stats-card shadow-sm mb-4">
      <Card.Body>
        <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
          <div>
            <Card.Title className="stats-eyebrow mb-1">Activity Consistency</Card.Title>
            <div className="small text-muted">{summary}</div>
          </div>
          <ButtonGroup size="sm" aria-label="Heatmap mode">
            <ToggleButton
              id="heatmap-mode-reading"
              type="radio"
              variant="outline-primary"
              name="heatmap-mode"
              value="reading"
              checked={mode === 'reading'}
              onChange={() => setMode('reading')}
            >
              Reading
            </ToggleButton>
            <ToggleButton
              id="heatmap-mode-listening"
              type="radio"
              variant="outline-primary"
              name="heatmap-mode"
              value="listening"
              checked={mode === 'listening'}
              onChange={() => setMode('listening')}
            >
              Listening
            </ToggleButton>
          </ButtonGroup>
        </div>

        <div className="stats-heatmap" role="grid" aria-label="Daily activity heatmap">
          {dateRange.map((dateKey) => {
            const value = valueByDate.get(dateKey) || 0;
            const level = bucketIntensity(value, max);
            const label = `${dateKey}: ${value > 0 ? formatValue(value) : 'no activity'}`;
            return (
              <div
                key={dateKey}
                className={`stats-heatmap-cell stats-heatmap-level-${level}`}
                role="gridcell"
                aria-label={label}
                title={label}
              />
            );
          })}
        </div>

        <div className="d-flex align-items-center gap-2 mt-3 small text-muted">
          <span>Less</span>
          <div className="stats-heatmap-cell stats-heatmap-level-0" />
          <div className="stats-heatmap-cell stats-heatmap-level-1" />
          <div className="stats-heatmap-cell stats-heatmap-level-2" />
          <div className="stats-heatmap-cell stats-heatmap-level-3" />
          <div className="stats-heatmap-cell stats-heatmap-level-4" />
          <span>More</span>
        </div>
      </Card.Body>
    </Card>
  );
};

export default ActivityHeatmap;
