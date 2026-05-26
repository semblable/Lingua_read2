import React from 'react';
import { Badge, Card, ListGroup } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import type { RecentTexts } from '../../utils/api/texts';

type RecentText = RecentTexts[number];

interface MoreToResumeListProps {
  texts: RecentTexts;
}

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

const MoreToResumeList: React.FC<MoreToResumeListProps> = ({ texts }) => {
  if (!texts || texts.length === 0) return null;

  return (
    <Card className="shadow-sm h-100" data-testid="more-to-resume">
      <Card.Body className="d-flex flex-column">
        <Card.Subtitle className="text-muted small text-uppercase fw-bold mb-2">
          More to resume
        </Card.Subtitle>
        <ListGroup variant="flush" className="flex-grow-1">
          {texts.map((t) => {
            const lastAccessed = (t as { lastAccessedAt?: string }).lastAccessedAt;
            const when = relativeTime(lastAccessed);
            return (
              <ListGroup.Item
                key={t.textId}
                action
                as={Link}
                to={`/texts/${t.textId}`}
                className="px-0 py-2"
                data-testid="more-to-resume-item"
              >
                <div className="d-flex justify-content-between align-items-start gap-2">
                  <div
                    className="text-truncate fw-semibold"
                    style={{ minWidth: 0, flex: 1 }}
                  >
                    {formatTitle(t)}
                  </div>
                  {t.isAudioLesson && (
                    <Badge bg="info" pill style={{ fontSize: '0.6rem' }}>
                      Audio
                    </Badge>
                  )}
                </div>
                <div className="text-muted small">
                  {t.languageName ? t.languageName : ''}
                  {t.languageName && when ? ' · ' : ''}
                  {when ?? ''}
                </div>
              </ListGroup.Item>
            );
          })}
        </ListGroup>
      </Card.Body>
    </Card>
  );
};

export default MoreToResumeList;
