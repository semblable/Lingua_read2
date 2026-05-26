import React, { useEffect, useState } from 'react';
import { Alert, Badge, Container, Spinner } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { getRecentTexts } from '../utils/api';
import type { RecentTexts } from '../utils/api/texts';
import { useAuthStore } from '../utils/store';
import './HomeLite.css';

type RecentText = RecentTexts[number];

/* ───────── helpers ───────── */

const formatTitle = (t: RecentText): string => {
  if (t.bookTitle) {
    const part = t.partNumber ? ` · Part ${t.partNumber}` : '';
    return `${t.bookTitle}${part}`;
  }
  return t.title || 'Untitled';
};

const relativeTime = (iso: string | undefined | null): string | null => {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diffMs = Date.now() - then;
  if (diffMs < 0) return 'just now';
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.round(months / 12);
  return `${years}y ago`;
};

/* ───────── component ───────── */

const HomeLite: React.FC = () => {
  const { user } = useAuthStore();
  const [texts, setTexts] = useState<RecentTexts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    getRecentTexts()
      .then((data) => {
        if (!cancelled) setTexts(data ?? []);
      })
      .catch(() => {
        if (!cancelled) { setTexts([]); setError(true); }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const recent = texts ?? [];
  const greeting = user?.username ? `Hi, ${user.username}` : 'Welcome back';

  return (
    <Container className="py-4" style={{ maxWidth: 680 }}>

      {/* Greeting */}
      <h4 className="mb-4 fw-normal" style={{ opacity: 0.85 }}>
        {greeting}
      </h4>

      {error && (
        <Alert variant="danger" className="mb-3">
          Couldn't load recent texts. Please refresh.
        </Alert>
      )}

      {loading ? (
        <div className="text-center py-5">
          <Spinner animation="border" size="sm" />
        </div>
      ) : recent.length === 0 ? (
        <div className="text-muted text-center py-5">
          No recent texts.{' '}
          <Link to="/library">Open library</Link> or{' '}
          <Link to="/texts/create">add a text</Link> to get started.
        </div>
      ) : (
        <div className="homelite-list">
          {recent.map((t) => {
            const lastAccessed = (t as { lastAccessedAt?: string }).lastAccessedAt;
            const when = relativeTime(lastAccessed);
            return (
              <Link
                key={t.textId}
                to={`/texts/${t.textId}`}
                className="homelite-item"
              >
                <div className="homelite-item-main">
                  <span className="homelite-item-title">
                    {formatTitle(t)}
                  </span>
                  <div className="homelite-item-meta">
                    {t.languageName && (
                      <Badge bg="secondary" pill className="homelite-lang-badge">
                        {t.languageName}
                      </Badge>
                    )}
                    {t.isAudioLesson && (
                      <Badge bg="info" pill className="homelite-lang-badge">
                        Audio
                      </Badge>
                    )}
                    {when && <span className="homelite-time">{when}</span>}
                  </div>
                </div>
                <span className="homelite-arrow">›</span>
              </Link>
            );
          })}
        </div>
      )}

      {/* Quick nav row */}
      <div className="homelite-nav mt-4">
        <Link to="/library" className="homelite-nav-link">Library</Link>
        <Link to="/srs" className="homelite-nav-link">SRS Review</Link>
        <Link to="/texts/create" className="homelite-nav-link">+ Add text</Link>
      </div>
    </Container>
  );
};

export default HomeLite;
