import React from 'react';
import { Link } from 'react-router-dom';

interface HomeHeroProps {
  username?: string;
  todayWords?: number;
  todayListeningSeconds?: number;
  topGoalSummary?: string | null;
  streakDays?: number;
  goalAction?: React.ReactNode;
}

const HomeHero: React.FC<HomeHeroProps> = ({
  username, todayWords = 0, todayListeningSeconds = 0, topGoalSummary, streakDays = 0, goalAction,
}) => {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : hour < 21 ? 'Good evening' : 'Hello';
  const name = username?.trim();
  return (
    <header className="home-hero">
      <div className="home-eyebrow">Today</div>
      <h1>{greeting}{name ? `, ${name}` : ''}.</h1>
      <div className="home-today" aria-label="Today's activity">
        <span><strong>{todayWords.toLocaleString()}</strong> words read today</span>
        <span><strong>{Math.round(todayListeningSeconds / 60)}</strong> min listened</span>
        {streakDays > 0 && (
          <Link to="/statistics" className="home-streak" data-testid="hero-chip-streak">
            <i className="bi bi-fire" aria-hidden="true" /> {streakDays}-day streak
          </Link>
        )}
        {goalAction}
      </div>
      {topGoalSummary && <Link to="/goals" className="home-goal-note" data-testid="hero-chip-goal">{topGoalSummary} →</Link>}
    </header>
  );
};

export default HomeHero;
