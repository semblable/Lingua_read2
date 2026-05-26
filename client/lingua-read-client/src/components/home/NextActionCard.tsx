import React from 'react';
import { Button, Card, Spinner } from 'react-bootstrap';
import { LinkContainer } from 'react-router-bootstrap';
import type { RecentTexts } from '../../utils/api/texts';

type RecentText = RecentTexts[number];

export interface NextActionCardProps {
  srsDue: number;
  recentText: RecentText | null;
  lastActivityAt: string | null;
  loading?: boolean;
}

type ActionKind = 'srs-heavy' | 'stalled' | 'srs-some' | 'continue' | 'fallback';
type ActionVariant = 'danger' | 'warning' | 'primary' | 'secondary';

interface PickedAction {
  kind: ActionKind;
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaTo: string;
  variant: ActionVariant;
}

const STALLED_THRESHOLD_DAYS = 3;
const SRS_CARDS_PER_MINUTE = 4;

const formatRecentTitle = (text: RecentText): string => {
  if (text.bookTitle) {
    const part = text.partNumber ? ` · Part ${text.partNumber}` : '';
    return `${text.bookTitle}${part}`;
  }
  return text.title || 'your last text';
};

const daysSince = (iso: string | null): number | null => {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return (Date.now() - then) / (1000 * 60 * 60 * 24);
};

export const pickAction = (
  srsDue: number,
  recentText: RecentText | null,
  lastActivityAt: string | null,
): PickedAction => {
  if (srsDue > 10) {
    const minutes = Math.max(1, Math.ceil(srsDue / SRS_CARDS_PER_MINUTE));
    return {
      kind: 'srs-heavy',
      title: `Review ${srsDue.toLocaleString()} cards`,
      subtitle: `~${minutes} min · clear the backlog before it grows.`,
      ctaLabel: 'Start reviewing',
      ctaTo: '/srs',
      variant: 'danger',
    };
  }

  // Round to the nearest whole day for both the threshold check and the
  // subtitle. With floor, a 3.9-day gap displayed as "3 days" felt off
  // ("but it's been almost 4 days") — and the threshold (> 3) firing on
  // 3.1 days then showing "3 days" was actively confusing.
  const stalledDaysRaw = daysSince(lastActivityAt);
  const stalledDays = stalledDaysRaw != null ? Math.round(stalledDaysRaw) : null;
  if (
    recentText &&
    recentText.textId != null &&
    stalledDays != null &&
    stalledDays > STALLED_THRESHOLD_DAYS
  ) {
    return {
      kind: 'stalled',
      title: `Pick up "${formatRecentTitle(recentText)}"`,
      subtitle: `You haven't opened it in ${stalledDays} day${stalledDays === 1 ? '' : 's'}.`,
      ctaLabel: 'Resume',
      ctaTo: `/texts/${recentText.textId}`,
      variant: 'primary',
    };
  }

  if (srsDue > 0) {
    return {
      kind: 'srs-some',
      title: `Quick review: ${srsDue} card${srsDue === 1 ? '' : 's'}`,
      subtitle: 'A few minutes keeps your retention scheduled.',
      ctaLabel: 'Review now',
      ctaTo: '/srs',
      variant: 'warning',
    };
  }

  if (recentText && recentText.textId != null) {
    return {
      kind: 'continue',
      title: `Continue "${formatRecentTitle(recentText)}"`,
      subtitle: 'Right where you left off.',
      ctaLabel: 'Resume',
      ctaTo: `/texts/${recentText.textId}`,
      variant: 'primary',
    };
  }

  return {
    kind: 'fallback',
    title: 'Browse your library',
    subtitle: 'Nothing pressing today — pick something to read.',
    ctaLabel: 'Open library',
    ctaTo: '/library',
    variant: 'secondary',
  };
};

const variantColor = (variant: ActionVariant): string => {
  switch (variant) {
    case 'danger':
      return '#dc3545';
    case 'warning':
      return '#ffc107';
    case 'primary':
      return '#0d6efd';
    default:
      return '#6c757d';
  }
};

const NextActionCard: React.FC<NextActionCardProps> = ({
  srsDue,
  recentText,
  lastActivityAt,
  loading,
}) => {
  if (loading) {
    return (
      <Card className="shadow-sm mb-4" data-testid="next-action-card">
        <Card.Body
          className="d-flex align-items-center justify-content-center"
          style={{ minHeight: 120 }}
        >
          <Spinner animation="border" />
        </Card.Body>
      </Card>
    );
  }

  const action = pickAction(srsDue, recentText, lastActivityAt);
  const accent = variantColor(action.variant);

  return (
    <Card
      className="shadow-sm mb-4"
      data-testid="next-action-card"
      data-action-kind={action.kind}
      style={{ borderLeft: `4px solid var(--bs-${action.variant}, ${accent})` }}
    >
      <Card.Body className="d-flex flex-wrap gap-3 align-items-center justify-content-between">
        <div className="flex-grow-1" style={{ minWidth: 200 }}>
          <div className="text-muted small text-uppercase fw-bold mb-1">Next up</div>
          <div className="fw-bold" style={{ fontSize: '1.35rem', lineHeight: 1.25 }}>
            {action.title}
          </div>
          <div className="text-muted small mt-1">{action.subtitle}</div>
        </div>
        <LinkContainer to={action.ctaTo}>
          <Button variant={action.variant} size="lg">
            {action.ctaLabel}
          </Button>
        </LinkContainer>
      </Card.Body>
    </Card>
  );
};

export default NextActionCard;
