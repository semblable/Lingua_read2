import React, { useMemo, useState } from 'react';
import { ButtonGroup, Card, ToggleButton } from 'react-bootstrap';
import { formatDuration, periodDayCount } from '../../utils/statistics';
import type {
  ListeningActivity,
  ListeningActivityPoint,
  ReadingActivity,
  ReadingActivityPoint
} from '../../utils/statistics';

interface DayCell {
  dateKey: string;
  inRange: boolean;
  month: number;
  year: number;
  dayOfMonth: number;
}

type WeekCells = DayCell[];

interface MonthLabel {
  label: string;
  weekIdx: number;
}

const HEATMAP_FALLBACK_DAYS = 26 * 7;
const CELL_SIZE = 14;
const CELL_GAP = 3;
const CELL_STEP = CELL_SIZE + CELL_GAP; // 17px per column
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Day-of-week rows: index 0=Sun … 6=Sat; only show Mon/Wed/Fri labels
const DAY_ROWS = [
  { dow: 0, label: '' },
  { dow: 1, label: 'Mon' },
  { dow: 2, label: '' },
  { dow: 3, label: 'Wed' },
  { dow: 4, label: '' },
  { dow: 5, label: 'Fri' },
  { dow: 6, label: '' },
];

const formatDateKey = (date: Date): string => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const bucketIntensity = (value: number, max: number): number => {
  if (!value || value <= 0) return 0;
  if (max <= 0) return 0;
  const ratio = value / max;
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.25) return 2;
  return 1;
};

// Build an array of weeks (each week = 7 day objects, Sun–Sat).
// Days before the numDays window are marked inRange:false (rendered as transparent).
const generateWeeks = (numDays: number): WeekCells[] => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rangeStart = new Date(today);
  rangeStart.setDate(today.getDate() - numDays + 1);

  // Align grid start to the Sunday on or before rangeStart
  const gridStart = new Date(rangeStart);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());

  const weeks: WeekCells[] = [];
  const cur = new Date(gridStart);

  while (cur <= today) {
    const week: WeekCells = [];
    for (let d = 0; d < 7; d++) {
      week.push({
        dateKey: formatDateKey(cur),
        inRange: cur >= rangeStart && cur <= today,
        month: cur.getMonth(),
        year: cur.getFullYear(),
        dayOfMonth: cur.getDate(),
      });
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
};

// Place a month label on the week that contains the 1st of each month.
// Always label the first visible week regardless.
const buildMonthLabels = (weeks: WeekCells[]): MonthLabel[] => {
  const labels: MonthLabel[] = [];
  weeks.forEach((week: WeekCells, wi: number) => {
    if (wi === 0) {
      const pivot = week.find((d: DayCell) => d.inRange) || week[0];
      labels.push({ label: MONTH_SHORT[pivot.month], weekIdx: 0 });
      return;
    }
    const firstOfMonth = week.find((d: DayCell) => d.dayOfMonth === 1);
    if (firstOfMonth) {
      labels.push({ label: MONTH_SHORT[firstOfMonth.month], weekIdx: wi });
    }
  });
  return labels;
};

interface ActivityHeatmapProps {
  readingActivity: ReadingActivity;
  listeningActivity: ListeningActivity;
  period: string;
}

const ActivityHeatmap = ({ readingActivity, listeningActivity, period }: ActivityHeatmapProps) => {
  const [mode, setMode] = useState('reading');

  const periodDays = periodDayCount(period);
  const numDays = periodDays && periodDays >= 7 ? periodDays : HEATMAP_FALLBACK_DAYS;

  const weeks = useMemo(() => generateWeeks(numDays), [numDays]);

  const valueByDate = useMemo(() => {
    const map = new Map();
    if (mode === 'reading') {
      (readingActivity?.activityByDate || []).forEach((entry: ReadingActivityPoint) => {
        if (entry?.date) map.set(entry.date, entry.wordsRead || 0);
      });
    } else {
      (listeningActivity?.listeningByDate || []).forEach((entry: ListeningActivityPoint) => {
        if (entry?.date) map.set(entry.date, entry.minutesListened || 0);
      });
    }
    return map;
  }, [mode, readingActivity, listeningActivity]);

  const max = useMemo(() => {
    let m = 0;
    valueByDate.forEach((v) => { if (v > m) m = v; });
    return m;
  }, [valueByDate]);

  const totalActive = useMemo(() => {
    let count = 0;
    weeks.forEach((week) =>
      week.forEach((day) => {
        if (day.inRange && (valueByDate.get(day.dateKey) || 0) > 0) count += 1;
      })
    );
    return count;
  }, [valueByDate, weeks]);

  const monthLabels = useMemo(() => buildMonthLabels(weeks), [weeks]);

  const formatValue = (value: number): string => {
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

        <div className="stats-heatmap-outer" role="grid" aria-label="Daily activity heatmap">
          {/* Day-of-week labels column */}
          <div className="stats-heatmap-day-labels" aria-hidden="true">
            <div className="stats-heatmap-month-spacer" />
            {DAY_ROWS.map(({ dow, label }) => (
              <div key={dow} className="stats-heatmap-day-label">{label}</div>
            ))}
          </div>

          {/* Month labels + week grid */}
          <div className="stats-heatmap-right">
            <div className="stats-heatmap-month-row" aria-hidden="true">
              {monthLabels.map(({ label, weekIdx }) => (
                <span
                  key={`${label}-${weekIdx}`}
                  className="stats-heatmap-month-label"
                  style={{ left: weekIdx * CELL_STEP }}
                >
                  {label}
                </span>
              ))}
            </div>

            <div className="stats-heatmap-weeks">
              {weeks.map((week, wi) => (
                <div key={wi} className="stats-heatmap-week">
                  {week.map((day) => {
                    const value = day.inRange ? (valueByDate.get(day.dateKey) || 0) : null;
                    const level = value === null ? 'empty' : bucketIntensity(value, max);
                    const label = day.inRange
                      ? `${day.dateKey}: ${value > 0 ? formatValue(value) : 'no activity'}`
                      : '';
                    return (
                      <div
                        key={day.dateKey}
                        className={`stats-heatmap-cell stats-heatmap-level-${level}`}
                        role={day.inRange ? 'gridcell' : 'presentation'}
                        aria-label={label || undefined}
                        title={label || undefined}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
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
