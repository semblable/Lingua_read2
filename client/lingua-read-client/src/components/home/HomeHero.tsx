import React from 'react';

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

const buildSubtitle = (
  srsDue: number,
  topGoalSummary: string | null | undefined,
  streakDays: number,
): string => {
  const parts: string[] = [];
  if (srsDue > 0) {
    parts.push(`${srsDue} SRS card${srsDue === 1 ? '' : 's'} due`);
  }
  if (topGoalSummary) {
    parts.push(topGoalSummary);
  }
  if (streakDays > 0) {
    parts.push(`${streakDays}-day streak`);
  }
  if (parts.length === 0) return 'Pick up where you left off.';
  return parts.join(' · ');
};

const HomeHero: React.FC<HomeHeroProps> = ({
  username,
  srsDue = 0,
  topGoalSummary,
  streakDays = 0,
}) => {
  const greeting = greetingForHour(new Date().getHours());
  const name = (username && username.trim()) || null;
  const subtitle = buildSubtitle(srsDue, topGoalSummary, streakDays);

  return (
    <div className="mb-4">
      <h1 className="mb-1 fw-bold" style={{ fontSize: 'clamp(1.6rem, 4vw, 2.25rem)' }}>
        {name ? `${greeting}, ${name}.` : `${greeting}.`}
      </h1>
      <div className="text-muted" style={{ fontSize: '1rem' }}>
        {subtitle}
      </div>
    </div>
  );
};

export default HomeHero;
