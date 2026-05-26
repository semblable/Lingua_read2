import React from 'react';
import { Badge } from 'react-bootstrap';
import { Link } from 'react-router-dom';

interface HomeHeroProps {
  username?: string;
  srsDue?: number;
  topGoalSummary?: string | null;
  streakDays?: number;
}

const greetingForHour = (hour: number): string => {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Working late';
};

interface Chip {
  label: string;
  to: string;
  bg: string;
  testId: string;
}

const buildChips = (
  srsDue: number,
  topGoalSummary: string | null | undefined,
  streakDays: number,
): Chip[] => {
  const chips: Chip[] = [];
  if (streakDays > 0) {
    chips.push({
      label: `${streakDays}-day streak`,
      to: '/statistics',
      bg: 'success',
      testId: 'hero-chip-streak',
    });
  }
  if (srsDue > 0) {
    chips.push({
      label: `${srsDue} SRS card${srsDue === 1 ? '' : 's'} due`,
      to: '/srs',
      bg: srsDue > 10 ? 'danger' : 'warning',
      testId: 'hero-chip-srs',
    });
  }
  if (topGoalSummary) {
    chips.push({
      label: topGoalSummary,
      to: '/goals',
      bg: 'primary',
      testId: 'hero-chip-goal',
    });
  }
  return chips;
};

const HomeHero: React.FC<HomeHeroProps> = ({
  username,
  srsDue = 0,
  topGoalSummary,
  streakDays = 0,
}) => {
  const greeting = greetingForHour(new Date().getHours());
  const name = (username && username.trim()) || null;
  const chips = buildChips(srsDue, topGoalSummary, streakDays);

  return (
    <div className="mb-4">
      <h1 className="mb-2 fw-bold" style={{ fontSize: 'clamp(1.6rem, 4vw, 2.25rem)' }}>
        {name ? `${greeting}, ${name}.` : `${greeting}.`}
      </h1>
      {chips.length === 0 ? (
        <div className="text-muted" style={{ fontSize: '1rem' }}>
          Pick up where you left off.
        </div>
      ) : (
        <div className="d-flex flex-wrap gap-2" data-testid="hero-chips">
          {chips.map((chip) => (
            <Badge
              key={chip.testId}
              as={Link}
              to={chip.to}
              bg={chip.bg}
              pill
              data-testid={chip.testId}
              className="text-decoration-none"
              style={{ fontSize: '0.85rem', padding: '0.45rem 0.75rem' }}
            >
              {chip.label}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
};

export default HomeHero;
