import React from 'react';
import { Overlay, Popover, Button, Badge } from 'react-bootstrap';
import {
  WORD_STATUS_LABELS as STATUS_LABELS,
  WORD_STATUS_VARIANTS as STATUS_VARIANTS,
  type WordStatus
} from '../types/wordStatus';

export type { WordStatus };

interface GradeLabel {
  grade: number;
  label: string;
  variant: string;
}

const GRADE_LABELS: GradeLabel[] = [
  { grade: 0, label: 'Again', variant: 'danger' },
  { grade: 1, label: 'Hard', variant: 'warning' },
  { grade: 2, label: 'Good', variant: 'success' },
  { grade: 3, label: 'Easy', variant: 'info' },
];

interface SrsWord {
  wordId: number | string;
  term: string;
  translation?: string;
  wordStatus: number;
}

interface SrsWordPopoverProps {
  word: SrsWord | null;
  targetRef: React.RefObject<HTMLElement> | HTMLElement | null;
  show: boolean;
  onHide: () => void;
  onGrade: (word: SrsWord, grade: number) => void;
  disabled?: boolean;
}

const SrsWordPopover = ({ word, targetRef, show, onHide, onGrade, disabled }: SrsWordPopoverProps) => {
  if (!word || !targetRef) return null;

  return (
    <Overlay
      target={targetRef}
      show={show}
      placement="top"
      rootClose
      onHide={onHide}
    >
      <Popover id={`srs-popover-${word.wordId}`} className="srs-story-popover">
        <Popover.Header className="d-flex justify-content-between align-items-center py-2">
          <span className="fw-bold">{word.term}</span>
          <Badge bg={STATUS_VARIANTS[word.wordStatus as WordStatus]} className="ms-2" style={{ fontSize: '0.65rem' }}>
            {STATUS_LABELS[word.wordStatus as WordStatus]}
          </Badge>
        </Popover.Header>
        <Popover.Body className="py-2 px-3">
          <div className="mb-2 text-muted" style={{ fontSize: '0.9rem' }}>{word.translation}</div>
          <div className="srs-grade-buttons d-flex gap-1">
            {GRADE_LABELS.map(({ grade, label, variant }) => (
              <Button
                key={grade}
                variant={variant}
                size="sm"
                className="srs-grade-btn flex-fill"
                onClick={() => onGrade(word, grade)}
                disabled={disabled}
                style={{ fontSize: '0.75rem', padding: '0.35rem 0.2rem', borderRadius: '8px', border: 'none' }}
              >
                {label}
              </Button>
            ))}
          </div>
        </Popover.Body>
      </Popover>
    </Overlay>
  );
};

export default SrsWordPopover;
