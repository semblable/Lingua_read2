import React, { useEffect, useRef, useState } from 'react';
import { Form } from 'react-bootstrap';

export interface ClozeReviewCardProps {
  /** Stable identity used to reset the typed answer when the card changes. */
  cardId: number | string;
  clozeSentence: string;
  term: string;
  translation: string;
  isFlipped: boolean;
  onReveal: () => void;
  /** Optional extra mined sentences shown on the back face. */
  otherPhrases?: ReadonlyArray<{ srsPhraseId?: number; sentence?: string | null }>;
}

const ClozeReviewCard: React.FC<ClozeReviewCardProps> = ({
  cardId,
  clozeSentence,
  term,
  translation,
  isFlipped,
  onReveal,
  otherPhrases = [],
}) => {
  const [typedAnswer, setTypedAnswer] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset the answer when navigating to a different card.
  useEffect(() => {
    setTypedAnswer('');
  }, [cardId]);

  // Autofocus the input on the front face so the user can start typing right away.
  useEffect(() => {
    if (!isFlipped && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isFlipped, cardId]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onReveal();
    }
  };

  const normalizedTyped = typedAnswer.trim().toLowerCase();
  const normalizedTerm = term.trim().toLowerCase();
  const matched = normalizedTyped.length > 0 && normalizedTyped === normalizedTerm;

  return (
    <div data-testid="cloze-review-card" className="text-center w-100">
      <p className="srs-sentence mb-3" data-testid="cloze-sentence">
        {clozeSentence}
      </p>

      {!isFlipped ? (
        <div className="d-flex flex-column align-items-center">
          <Form.Control
            ref={inputRef}
            type="text"
            value={typedAnswer}
            onChange={(e) => setTypedAnswer(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Type the missing word…"
            data-testid="cloze-input"
            style={{ maxWidth: '320px' }}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="mt-3 srs-reveal-hint">
            Press <kbd>Enter</kbd> to reveal
          </div>
        </div>
      ) : (
        <div className="srs-answer-area mt-2 pt-2 border-top w-100">
          {typedAnswer.length > 0 && (
            <div className="mb-2" data-testid="cloze-comparison">
              <small className="text-muted d-block">Your answer:</small>
              <span
                className={matched ? 'text-success fw-semibold' : 'text-danger fw-semibold'}
                data-testid="cloze-user-answer"
                data-cloze-match={matched ? 'true' : 'false'}
              >
                {typedAnswer}
              </span>
              {!matched && (
                <span className="text-muted ms-2">
                  → expected <strong data-testid="cloze-expected">{term}</strong>
                </span>
              )}
              {matched && (
                <span className="text-success ms-2" aria-label="correct">✓</span>
              )}
            </div>
          )}
          {typedAnswer.length === 0 && (
            <div className="mb-2">
              <small className="text-muted d-block">Answer:</small>
              <strong data-testid="cloze-expected">{term}</strong>
            </div>
          )}
          <p className="srs-translation mb-2">
            {translation || <em className="text-muted">No translation</em>}
          </p>

          {otherPhrases.length > 0 && (
            <div className="mt-2 text-start">
              <small className="text-muted d-block mb-1">Other mined sentences:</small>
              {otherPhrases.map((phrase) => (
                <small key={phrase.srsPhraseId} className="srs-other-phrases d-block mb-1">
                  "{phrase.sentence}"
                </small>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ClozeReviewCard;
