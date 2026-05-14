import React, { useState, useEffect, useCallback } from 'react';
import { Overlay, Popover, Button, Badge, Spinner } from 'react-bootstrap';
import { translateSelectionWithContext } from '../utils/api';

const STATUS_LABELS = { 1: 'New', 2: 'Learning', 3: 'Familiar', 4: 'Advanced', 5: 'Known' };
const STATUS_VARIANTS = { 1: 'danger', 2: 'warning', 3: 'info', 4: 'primary', 5: 'success' };

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
}) => {
  const [translation, setTranslation] = useState('');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const doTranslate = useCallback(async () => {
    if (!word || !sourceLanguageCode || !targetLanguageCode) return;
    setLoading(true);
    try {
      const result = await translateSelectionWithContext(
        word, sentenceContext || '', sourceLanguageCode, targetLanguageCode
      );
      // Defensive fallback to `.translation` for legacy responses — cast
      // because the typed shape only exposes `translatedText`.
      const legacy = result as { translation?: string };
      setTranslation(result.translatedText || legacy.translation || '');
    } catch (err) {
      console.error('Translation failed:', err);
      setTranslation('');
    } finally {
      setLoading(false);
    }
  }, [word, sentenceContext, sourceLanguageCode, targetLanguageCode]);

  useEffect(() => {
    if (!show || !word) return;
    setSaved(false);
    if (existingWord?.translation) {
      setTranslation(existingWord.translation);
    } else {
      setTranslation('');
      doTranslate();
    }
  }, [show, word, existingWord, doTranslate]);

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
            <Badge bg={STATUS_VARIANTS[existingWord.status]} className="ms-2" style={{ fontSize: '0.65rem' }}>
              {STATUS_LABELS[existingWord.status]}
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
