import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Form } from 'react-bootstrap';

export interface ClozeReviewCardProps {
  /** Stable identity used to reset the typed answer and hints when the card changes. */
  cardId: number | string;
  clozeSentence: string;
  term: string;
  translation: string;
  isFlipped: boolean;
  onReveal: () => void;
  /** Optional extra mined sentences shown on the back face. */
  otherPhrases?: ReadonlyArray<{ srsPhraseId?: number; sentence?: string | null }>;
  /** Optional callback reporting hint usage when card is flipped or hint is taken. */
  onHintUsed?: (revealedLetters: number, totalLetters: number) => void;
}

const isMaskableLetter = (ch: string): boolean => /\p{L}|\p{N}/u.test(ch);

const splitGraphemes = (text: string): string[] => {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  return [...text];
};

const ClozeReviewCard: React.FC<ClozeReviewCardProps> = ({
  cardId,
  clozeSentence,
  term,
  translation,
  isFlipped,
  onReveal,
  otherPhrases = [],
  onHintUsed,
}) => {
  const characters = useMemo(() => splitGraphemes(term), [term]);
  const totalLetters = useMemo(
    () => characters.filter(isMaskableLetter).length,
    [characters]
  );

  const [prevCardId, setPrevCardId] = useState(cardId);
  const [prevIsFlipped, setPrevIsFlipped] = useState(isFlipped);
  const [revealedCount, setRevealedCount] = useState(0);
  const [typedAnswer, setTypedAnswer] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset answer and hints when navigating to a different card or re-presenting
  // the same card unflipped (e.g., when a learning-step card is immediately requeued).
  if (prevCardId !== cardId || (prevIsFlipped && !isFlipped)) {
    setPrevCardId(cardId);
    setPrevIsFlipped(isFlipped);
    setTypedAnswer('');
    setRevealedCount(0);
  } else if (prevIsFlipped !== isFlipped) {
    setPrevIsFlipped(isFlipped);
  }

  // Autofocus the input on the front face so the user can start typing right away.
  useEffect(() => {
    if (!isFlipped && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isFlipped, cardId]);

  const handleRevealLetter = useCallback(() => {
    if (revealedCount >= totalLetters) return;
    const nextCount = revealedCount + 1;
    setRevealedCount(nextCount);

    // Compute revealed prefix up to nextCount letters
    let lettersSeen = 0;
    let lastRevIdx = -1;
    for (let i = 0; i < characters.length; i++) {
      if (isMaskableLetter(characters[i])) {
        if (lettersSeen < nextCount) {
          lettersSeen++;
          lastRevIdx = i;
        } else {
          break;
        }
      }
    }

    if (lastRevIdx >= 0) {
      let endIdx = lastRevIdx + 1;
      while (endIdx < characters.length && !isMaskableLetter(characters[endIdx])) {
        endIdx++;
      }
      const revealedPrefix = characters.slice(0, endIdx).join('');
      setTypedAnswer(revealedPrefix);
    }

    onHintUsed?.(nextCount, totalLetters);

    // Re-focus the input and place cursor at the end
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const len = inputRef.current.value.length;
        inputRef.current.setSelectionRange(len, len);
      }
    }, 0);
  }, [revealedCount, totalLetters, characters, onHintUsed]);

  // Alt+H reveals a hint; browser Ctrl+H remains available for history.
  useEffect(() => {
    if (isFlipped) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isInteractiveKeyboardTarget(e.target)) return;
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        handleRevealLetter();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFlipped, handleRevealLetter]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onReveal();
    } else if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'h' || e.key === 'H')) {
      e.preventDefault();
      handleRevealLetter();
    }
  };

  // Build the progressive scaffold slots
  let lettersCounted = 0;
  const scaffoldSlots = characters.map((ch, idx) => {
    const maskable = isMaskableLetter(ch);
    if (!maskable) {
      return { char: ch, isLetter: false, isRevealed: true, key: idx };
    }
    const isRevealed = lettersCounted < revealedCount;
    lettersCounted++;
    return { char: ch, isLetter: true, isRevealed, key: idx };
  });

  // Matching evaluation: exact match or diacritic-tolerant match
  const normalizedTyped = typedAnswer.trim().normalize('NFC').toLowerCase();
  const normalizedTerm = term.trim().normalize('NFC').toLowerCase();
  const exactMatch = normalizedTyped.length > 0 && normalizedTyped === normalizedTerm;

  // Tolerate accents on Latin letters, preserving phonemic marks in other
  // scripts (e.g. Japanese dakuten and Indic vowel signs).
  const stripDiacritics = (s: string) =>
    s.normalize('NFD').replace(/(\p{Script=Latin})(\p{M}+)/gu,
      (_match, base: string, marks: string) => base + marks.replace(/\p{Diacritic}/gu, ''));
  const diacriticTyped = stripDiacritics(normalizedTyped);
  const diacriticTerm = stripDiacritics(normalizedTerm);
  const diacriticMatch = diacriticTyped.length > 0 && diacriticTyped === diacriticTerm;

  const matched = exactMatch || diacriticMatch;
  const hasAccentDiff = !exactMatch && diacriticMatch;

  return (
    <div data-testid="cloze-review-card" className="text-center w-100">
      <p className="srs-sentence mb-2" data-testid="cloze-sentence">
        {clozeSentence}
      </p>

      {!isFlipped ? (
        <div className="d-flex flex-column align-items-center">
          {translation && (
            <div className="srs-cloze-cue mb-3 text-muted" data-testid="cloze-meaning-cue">
              <small className="text-uppercase fw-semibold text-secondary me-1">Meaning:</small>
              <span className="fst-italic">{translation}</span>
            </div>
          )}

          {totalLetters > 0 && (
            <div
              data-testid="cloze-scaffold"
              className="srs-cloze-scaffold mb-3"
              aria-label={`Target word length ${totalLetters} letters`}
            >
              {scaffoldSlots.map((slot) => (
                <span
                  key={slot.key}
                  data-testid="cloze-letter-slot"
                  data-revealed={slot.isRevealed ? 'true' : 'false'}
                  data-is-letter={slot.isLetter ? 'true' : 'false'}
                  className={`srs-cloze-slot ${
                    !slot.isLetter
                      ? 'srs-cloze-slot-literal'
                      : slot.isRevealed
                      ? 'srs-cloze-slot-revealed'
                      : 'srs-cloze-slot-unrevealed'
                  }`}
                >
                  {slot.isRevealed ? slot.char : '_'}
                </span>
              ))}
            </div>
          )}

          <div className="d-flex flex-column align-items-center w-100" style={{ maxWidth: '340px' }}>
            <div className="d-flex gap-2 w-100">
              <Form.Control
                ref={inputRef}
                type="text"
                value={typedAnswer}
                onChange={(e) => setTypedAnswer(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Type the missing word…"
                data-testid="cloze-input"
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                variant="outline-primary"
                onClick={handleRevealLetter}
                disabled={revealedCount >= totalLetters}
                data-testid="cloze-hint-button"
                title="Reveal the next letter (Alt+H)"
                className="text-nowrap"
              >
                💡 Hint
              </Button>
            </div>
            <div className="mt-2 srs-reveal-hint text-muted d-flex justify-content-between w-100 small">
              <span>Press <kbd>Enter</kbd> to reveal</span>
              <span data-testid="cloze-hint-counter">
                {revealedCount > 0 ? (
                  <span className="text-primary fw-medium">
                    {revealedCount}/{totalLetters} hints
                  </span>
                ) : (
                  <span><kbd>Alt+H</kbd> for hint</span>
                )}
              </span>
            </div>
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
              {matched && !hasAccentDiff && (
                <span className="text-success ms-2" aria-label="correct">✓</span>
              )}
              {matched && hasAccentDiff && (
                <span className="text-success ms-2 small" aria-label="correct with accent difference">
                  ✓ <span className="text-muted">(accent difference from {term})</span>
                </span>
              )}
              {!matched && (
                <span className="text-muted ms-2">
                  → expected <strong data-testid="cloze-expected">{term}</strong>
                </span>
              )}
            </div>
          )}
          {typedAnswer.length === 0 && (
            <div className="mb-2">
              <small className="text-muted d-block">Answer:</small>
              <strong data-testid="cloze-expected">{term}</strong>
            </div>
          )}

          {revealedCount > 0 && (
            <div className="mb-2" data-testid="cloze-hint-usage">
              <span className="badge bg-warning text-dark me-2">
                💡 {revealedCount} of {totalLetters} letters revealed
              </span>
              <small className="text-muted" data-testid="cloze-grade-advice">
                {revealedCount >= totalLetters
                  ? 'Full reveal — Recommended grade: Again'
                  : 'Scaffolded recall — Recommended grade: Hard or Again'}
              </small>
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
import { isInteractiveKeyboardTarget } from '../../utils/keyboard';
