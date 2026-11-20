import React, { useLayoutEffect, useRef } from 'react';
import { Button, Alert, Form, Spinner, Badge } from 'react-bootstrap';
import { lowercaseLookupTerm, type LanguageConfig } from '../../utils/readerText';
import { composeKoreanLookupText, isKoreanLanguageCode } from '../../utils/koreanLookup';
import type { DisplayedWord } from '../../types/displayedWord';
import { WORD_STATUS_LABELS, WORD_STATUS_VALUES, type WordStatus } from '../../types/wordStatus';
import DictionaryLookup, { type ReaderDictionary } from './DictionaryLookup';
import WiktionaryDefinitions from './WiktionaryDefinitions';

export type { DisplayedWord };

// LanguageConfig from readerText only covers tokenization; the API LanguageDto
// also carries the reader's external dictionary links.
export type WordInfoLanguageConfig =
  | (NonNullable<LanguageConfig> & {
      dictionaries?: ReaderDictionary[];
    })
  | null
  | undefined;

// --- Composite prop groups (Phase E3) ------------------------------------
// The pre-E3 25-prop interface was split into 5 logical groups in comments
// but flat in the type. E3 hoists those comments into named composite types,
// so callers can build each group once and pass a handful of objects rather
// than 25 individual props. Inner property names are scoped (e.g. `value`
// instead of `translation`) since the group name disambiguates.

export type WordInfoTranslationState = {
  value: string;
  // The translation stored with the word; undefined while the word is untracked.
  saved?: string;
  setValue: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  isTranslating: boolean;
  error: string | null;
};

export type WordInfoSpeechState = {
  sentenceTtsEnabled: boolean;
  canUseSentenceTts: boolean;
  isSpeakingWord: boolean;
  onSpeakWord: () => void;
};

export type WordInfoActions = {
  onSaveWord: (status: number) => void | Promise<void>;
  // Saves the box as it is, keeping the status (New for an untracked word); same as Enter.
  onSaveTranslation?: () => void;
  onSaveExactForm?: () => void;
  onSelectLemma?: (lemma: string) => void;
  processingWord: boolean;
  onReadingCredit?: (wordId: number | string) => void;
  onRetranslateWithContext?: () => void;
  canRetranslate?: boolean;
  onAddTranslationWithContext?: () => void;
  canAddTranslation?: boolean;
  onDeleteWord?: () => void;
};

export type WordInfoBookmarkState = {
  isSentenceBookmarked: boolean;
  onToggleBookmark: () => void;
};

export type WordInfoLanguageState = {
  languageConfig: WordInfoLanguageConfig;
};

// Optional rich Wiktionary definitions; enabled only when the user's word translation
// provider is Wiktionary and rich display is turned on.
export type WordInfoDefinitionState = {
  enabled: boolean;
  sourceLanguageCode: string;
};

export type WordInfoPhraseSelectionState = {
  canExtendPrev: boolean;
  canExtendNext: boolean;
  onExtendPrev: () => void;
  onExtendNext: () => void;
};

export type WordInfoPanelProps = {
  characterShortcutsEnabled?: boolean;
  displayedWord: DisplayedWord | null;
  selectedWord: string;
  saveSuccess: boolean;
  translation: WordInfoTranslationState;
  speech: WordInfoSpeechState;
  actions: WordInfoActions;
  bookmark: WordInfoBookmarkState;
  language: WordInfoLanguageState;
  definition?: WordInfoDefinitionState;
  phraseSelection?: WordInfoPhraseSelectionState;
};

const statusLabel = (status: number | undefined): string =>
  status !== undefined && status in WORD_STATUS_LABELS ? WORD_STATUS_LABELS[status as WordStatus] : 'Untracked';

const WordInfoPanel = React.memo(({
  displayedWord,
  selectedWord,
  saveSuccess,
  translation,
  speech,
  actions,
  bookmark,
  language,
  definition,
  phraseSelection,
  characterShortcutsEnabled = true
}: WordInfoPanelProps) => {
  const translationRef = useRef<HTMLTextAreaElement | null>(null);
  const translationSizingRef = useRef<{
    element: HTMLTextAreaElement;
    term: string | undefined;
    height: string;
    manualHeight: number;
  } | null>(null);
  useLayoutEffect(() => {
    const textarea = translationRef.current;
    if (!textarea) return;
    const previous = translationSizingRef.current;
    const sizing = previous?.element === textarea && previous.term === displayedWord?.term
      ? previous
      : { element: textarea, term: displayedWord?.term, height: textarea.style.height, manualHeight: 0 };
    translationSizingRef.current = sizing;
    const resize = () => {
      // Native dragging writes an inline height. Keep that choice while editing this word.
      if (textarea.style.height !== sizing.height) {
        sizing.manualHeight = parseFloat(textarea.style.height) || 0;
      }
      textarea.style.height = 'auto';
      const style = getComputedStyle(textarea);
      const lineHeight = parseFloat(style.lineHeight) || 20;
      const borders = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
      const extra = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0) + borders;
      // scrollHeight already includes padding; adding it twice made short glosses look four lines tall.
      // A manual size also allows shrinking long notes; overflow can scroll instead of snapping back.
      const height = sizing.manualHeight || textarea.scrollHeight + borders;
      textarea.style.height = `${Math.max(lineHeight * 2 + extra, height)}px`;
      sizing.height = textarea.style.height;
    };
    resize();
    let width = textarea.clientWidth;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      // Observing height here would immediately undo a drag of the resize handle.
      if (textarea.clientWidth !== width) {
        width = textarea.clientWidth;
        resize();
      }
    });
    observer?.observe(textarea);
    return () => observer?.disconnect();
  }, [translation.value, displayedWord?.term]);

  if (!displayedWord) {
    return (
      <div className="word-info-panel">
        <p className="mb-1">Click/hover on a word.</p>
        <p className="word-info-hint mb-0">{characterShortcutsEnabled
          ? 'Hover a word and press 1–5 to set its status, or I to ignore it.'
          : 'Character shortcuts are off. Select a word, then use its status controls.'}</p>
      </div>
    );
  }
  const status = displayedWord.status ?? 0;
  // Not `isNew`: the API also sets that on saved words of status 1.
  const isTracked = status > 0 && !!displayedWord.wordId;
  const statusButtonsDisabled = actions.processingWord || !selectedWord;
  const hasUnsavedTranslation = isTracked && translation.saved !== undefined
    && translation.value.trim() !== translation.saved.trim();
  const lookupLanguage = language.languageConfig?.code || language.languageConfig?.languageCode || definition?.sourceLanguageCode;
  const formKey = (term: string) => composeKoreanLookupText(lowercaseLookupTerm(term, lookupLanguage));
  const termKey = formKey(displayedWord.term || '');
  const hasDistinctSurface = !!displayedWord.surface && !!displayedWord.term
    && formKey(displayedWord.surface) !== termKey;
  // Korean is the only reader language with base-form analysis. Spelling aliases
  // in other languages don't justify an extra vocabulary entry.
  const canSaveExactForm = isKoreanLanguageCode(lookupLanguage) && hasDistinctSurface
    && displayedWord.lemmaCandidates?.some(candidate => formKey(candidate.lemma) === termKey);
  const hasUnsavedNewWord = !isTracked && !!translation.value.trim();
  let hint: React.ReactNode = null;
  if (translation.isTranslating) {
    hint = <><Spinner size="sm" className="me-1" />Translating…</>;
  } else if (hasUnsavedTranslation) {
    hint = <span className="word-info-hint-unsaved">Translation not saved yet.</span>;
  } else if (hasUnsavedNewWord) {
    hint = 'Not saved yet. Pick a status, or Save to add it as New.';
  }
  const showSaveButton = !!actions.onSaveTranslation && (hasUnsavedTranslation || hasUnsavedNewWord);

  return (
    <div className="word-info-panel">
      <div className="word-info-header">
        <div className="word-info-headword">
          <h5 className="word-info-term mb-0" dir={language.languageConfig?.rightToLeft === undefined ? 'auto' : language.languageConfig.rightToLeft ? 'rtl' : 'ltr'} lang={language.languageConfig?.code || undefined}>{displayedWord.term}</h5>
          {displayedWord.particleBadge != null && typeof displayedWord.particleBadge === 'string' && (
            <Badge bg="secondary" className="word-info-particle-badge" data-testid="korean-particle-badge">
              {displayedWord.particleBadge}
            </Badge>
          )}
        </div>
        <div className="word-info-header-tools">
          {phraseSelection && (phraseSelection.canExtendPrev || phraseSelection.canExtendNext) && (
            <div className="word-info-extend-row" role="group" aria-label="Extend selection">
              <Button variant="secondary" size="sm" className="word-info-utility word-extend-btn"
                onClick={phraseSelection.onExtendPrev} disabled={!phraseSelection.canExtendPrev || actions.processingWord}
                aria-label="Add previous word to selection" title="Include the previous word in this sentence">+ Prev</Button>
              <Button variant="secondary" size="sm" className="word-info-utility word-extend-btn"
                onClick={phraseSelection.onExtendNext} disabled={!phraseSelection.canExtendNext || actions.processingWord}
                aria-label="Add next word to selection" title="Include the next word in this sentence">+ Next</Button>
            </div>
          )}
          {bookmark.onToggleBookmark && (
            <Button variant="secondary" size="sm" className="word-info-utility word-info-icon word-info-bookmark"
              onClick={bookmark.onToggleBookmark} active={bookmark.isSentenceBookmarked}
              title={bookmark.isSentenceBookmarked ? 'Remove bookmark from this sentence' : 'Bookmark this sentence'}
              aria-pressed={bookmark.isSentenceBookmarked}
              aria-label={bookmark.isSentenceBookmarked ? 'Remove sentence bookmark' : 'Bookmark sentence'}>
              <svg viewBox="0 0 16 16" width="16" height="16" fill={bookmark.isSentenceBookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                <path d="M4 2.5h8v11l-4-2.7-4 2.7z" />
              </svg>
            </Button>
          )}
        </div>
      </div>
      {displayedWord.lemmaCandidates && displayedWord.lemmaCandidates.length > 1 && actions.onSelectLemma && (
        <div className="d-flex flex-wrap gap-1 mb-2" role="group" aria-label="Korean readings">
          {displayedWord.lemmaCandidates.map(candidate => (
            <Button
              key={candidate.lemma}
              size="sm"
              variant={selectedWord === candidate.lemma ? 'primary' : 'outline-secondary'}
              aria-pressed={selectedWord === candidate.lemma}
              title={candidate.particle ? `${candidate.particle} (${candidate.particleType})` : candidate.particleType}
              onClick={() => actions.onSelectLemma?.(candidate.lemma)}
              disabled={actions.processingWord}
            >{candidate.lemma}</Button>
          ))}
        </div>
      )}
      <div className="word-info-definition">
      <Form.Control
        ref={translationRef}
        dir="auto"
        as="textarea"
        rows={2}
        value={translation.value}
        onChange={(e) => translation.setValue(e.target.value)}
        onKeyDown={translation.onKeyDown}
        placeholder="Translation/Notes (Enter to save)"
        aria-label="Translation"
        disabled={translation.isTranslating}
        size="sm"
      />
      {(actions.onRetranslateWithContext || actions.onAddTranslationWithContext) && (
        <div className="word-info-definition-actions">
          {actions.onRetranslateWithContext && (
            <Button variant="secondary" size="sm" className="word-info-utility word-info-generate"
              onClick={actions.onRetranslateWithContext}
              disabled={!actions.canRetranslate || translation.isTranslating || actions.processingWord}
              title="Re-translate this word with AI using the current sentence as context">
              {translation.isTranslating ? 'Translating…' : 'AI Translate'}
            </Button>
          )}
          {actions.onAddTranslationWithContext && (
            <Button variant="secondary" size="sm" className="word-info-utility"
              onClick={actions.onAddTranslationWithContext}
              disabled={!actions.canAddTranslation || translation.isTranslating || actions.processingWord}
              title="Add an AI translation alongside the existing one" aria-label="Add AI translation">+ AI</Button>
          )}
        </div>
      )}
      </div>
      {(hint || showSaveButton) && (
        <div className="word-info-save-row">
          <div className="word-info-hint">{hint}</div>
          {showSaveButton && (
            <Button
              variant="primary"
              size="sm"
              className="py-0 px-2 ms-auto"
              onClick={actions.onSaveTranslation}
              disabled={statusButtonsDisabled || translation.isTranslating}
              title={isTracked ? 'Save this translation (Enter)' : 'Save this word as New (Enter)'}
            >
              Save
            </Button>
          )}
        </div>
      )}
      {translation.error && <Alert variant="danger" className="py-1 px-2 mt-1 mb-0 small">{translation.error}</Alert>}
      <div className="d-flex flex-wrap gap-1 mt-2 word-status-row" role="group" aria-label="Word status">
        {WORD_STATUS_VALUES.map(s => (
          <Button
            key={s}
            variant="outline-secondary"
            size="sm"
            className="py-0 px-2 word-status-btn"
            data-status={s}
            active={status === s}
            aria-pressed={status === s}
            aria-label={`${WORD_STATUS_LABELS[s]} (${s})`}
            onClick={() => actions.onSaveWord(s)}
            disabled={statusButtonsDisabled}
            title={`${WORD_STATUS_LABELS[s]}${characterShortcutsEnabled ? ` (key ${s} on a hovered word)` : ''}`}
          >
            {s}
          </Button>
        ))}
        <Button
          variant="outline-secondary"
          size="sm"
          className="py-0 px-2 word-status-btn"
          data-status={6}
          active={status === 6}
          aria-pressed={status === 6}
          onClick={() => actions.onSaveWord(6)}
          disabled={statusButtonsDisabled}
          title="Ignore this word — excluded from stats and reviews (key I on a hovered word)"
        >
          Ignore
        </Button>
      </div>
      <div className="word-info-grade-caption">
        <span className="word-info-status-label">{statusLabel(status)}</span>
        {saveSuccess && <span className="word-info-saved">✓ Saved</span>}
      </div>
      {canSaveExactForm && actions.onSaveExactForm && (
        <div className="mt-1 word-info-exact-row">
          <Button
            variant="link"
            size="sm"
            className="p-0 text-muted text-decoration-none word-info-save-exact-btn"
            onClick={actions.onSaveExactForm}
            disabled={statusButtonsDisabled}
            title={`Track this form separately from '${displayedWord.term}', with its own word status`}
          >
            Save exact form &apos;{String(displayedWord.surface)}&apos;
          </Button>
        </div>
      )}
      <div className="d-flex flex-wrap gap-1 mt-2 word-info-actions">
        {speech.sentenceTtsEnabled && (
          <Button
            variant="secondary"
            size="sm"
            className="word-info-utility"
            onClick={speech.onSpeakWord}
            disabled={!speech.canUseSentenceTts || !displayedWord?.term}
            title={speech.canUseSentenceTts ? 'Read this word aloud' : 'Speech synthesis is not supported in this browser'}
          >
            {speech.isSpeakingWord ? 'Speaking...' : 'Speak'}
          </Button>
        )}
        {displayedWord?.wordId && !displayedWord?.isNew && (displayedWord?.status ?? 0) >= 3 && (displayedWord?.status ?? 0) <= 4 && actions.onReadingCredit && (
          <Button
            variant="secondary"
            size="sm"
            className="word-info-utility"
            onClick={() => actions.onReadingCredit!(displayedWord.wordId!)}
            title="Count recognizing this word while reading toward its flashcard schedule"
          >
            Reading credit
          </Button>
        )}
        {/* Kept apart from the everyday actions so it isn't hit by accident. */}
        {actions.onDeleteWord && displayedWord?.wordId && (
          <Button
            variant="secondary"
            size="sm"
            className="word-info-utility word-info-icon word-info-delete ms-auto"
            onClick={actions.onDeleteWord}
            disabled={actions.processingWord || translation.isTranslating}
            title="Delete this term"
            aria-label="Delete this term"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
              <path d="M2.5 4.5h11M6 2.5h4l.5 2H5.5zM4 4.5l.7 9h6.6l.7-9M6.5 6.5v5M9.5 6.5v5" />
            </svg>
          </Button>
        )}
      </div>

      {definition?.enabled && displayedWord.term && (
        <WiktionaryDefinitions
          term={displayedWord.term}
          sourceLanguageCode={definition.sourceLanguageCode}
          enabled={definition.enabled}
        />
      )}

      {!!language.languageConfig?.dictionaries?.length && selectedWord && (
        <DictionaryLookup key={selectedWord} dictionaries={language.languageConfig.dictionaries} term={selectedWord} />
      )}
    </div>
  );
});

WordInfoPanel.displayName = 'WordInfoPanel';

export default WordInfoPanel;
