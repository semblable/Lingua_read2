import React, { useState, useEffect } from 'react';
import { Overlay, Popover, Button, Badge, Spinner } from 'react-bootstrap';
import { translateSelectionWithContext } from '../utils/api';
import {
  WORD_STATUS_LABELS as STATUS_LABELS,
  WORD_STATUS_VARIANTS as STATUS_VARIANTS,
  type WordStatus
} from '../types/wordStatus';

export interface ExistingWord {
  translation?: string;
  status?: number;
}

interface WordLookupPopoverProps {
  word: string | null;
  targetRef: React.RefObject<HTMLElement> | HTMLElement | null;
  show: boolean;
  onHide: () => void;
  onSave?: (word: string, translation: string, status: number) => Promise<void> | void;
  sourceLanguageCode?: string;
  targetLanguageCode?: string;
  sentenceContext?: string;
  existingWord?: ExistingWord | null;
}

const WordLookupPopover = ({
  word,
  targetRef,
  show,
  onHide,
  onSave,
  sourceLanguageCode,
  targetLanguageCode,
  sentenceContext,
  existingWord,
}: WordLookupPopoverProps) => {
  const [translation, setTranslation] = useState('');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const lookupSessionKey = show && word ? `${word}::${existingWord?.translation ?? ''}` : null;
  const [prevLookupSessionKey, setPrevLookupSessionKey] = useState<string | null>(null);
  if (lookupSessionKey !== prevLookupSessionKey) {
    setPrevLookupSessionKey(lookupSessionKey);
    if (lookupSessionKey !== null) {
      setSaved(false);
      if (existingWord?.translation) {
        setTranslation(existingWord.translation);
        setLoading(false);
      } else {
        setTranslation('');
        setLoading(Boolean(sourceLanguageCode && targetLanguageCode));
      }
    }
  }

  useEffect(() => {
    if (!show || !word || existingWord?.translation || !sourceLanguageCode || !targetLanguageCode) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await translateSelectionWithContext(
          word, sentenceContext || '', sourceLanguageCode, targetLanguageCode
        );
        if (cancelled) return;
        // Defensive fallback to `.translation` for legacy responses — cast
        // because the typed shape only exposes `translatedText`.
        const legacy = result as { translation?: string };
        setTranslation(result.translatedText || legacy.translation || '');
      } catch (err) {
        if (!cancelled) {
          console.error('Translation failed:', err);
          setTranslation('');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [show, word, existingWord?.translation, sentenceContext, sourceLanguageCode, targetLanguageCode]);

  const handleSave = async () => {
    if (!word || !onSave) return;
    setSaving(true);
    try {
      await onSave(word, translation, 1);
      setSaved(true);
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  if (!word || !targetRef || !show) return null;

  const alreadySaved = !!existingWord;

  return (
    <Overlay target={targetRef} show={show} placement="top" rootClose onHide={onHide}>
      <Popover id="word-lookup-popover" className="srs-story-popover">
        <Popover.Header className="d-flex justify-content-between align-items-center py-2">
          <span className="fw-bold">{word}</span>
          {alreadySaved && (
            <Badge bg={STATUS_VARIANTS[existingWord!.status as WordStatus]} className="ms-2" style={{ fontSize: '0.65rem' }}>
              {STATUS_LABELS[existingWord!.status as WordStatus]}
            </Badge>
          )}
        </Popover.Header>
        <Popover.Body className="py-2 px-3">
          <div className="mb-2" style={{ fontSize: '0.9rem', minHeight: '1.4em' }}>
            {loading ? (
              <Spinner animation="border" size="sm" className="me-1" />
            ) : (
              <span className="text-muted">{translation || '—'}</span>
            )}
          </div>
          {alreadySaved || saved ? (
            <div className="text-success" style={{ fontSize: '0.8rem' }}>
              {saved ? 'Saved!' : 'Already in vocabulary'}
            </div>
          ) : (
            <Button
              variant="outline-primary"
              size="sm"
              className="w-100"
              onClick={handleSave}
              disabled={saving || loading}
              style={{ fontSize: '0.75rem', borderRadius: '8px' }}
            >
              {saving ? <Spinner animation="border" size="sm" /> : 'Save Word'}
            </Button>
          )}
        </Popover.Body>
      </Popover>
    </Overlay>
  );
};

export default WordLookupPopover;
