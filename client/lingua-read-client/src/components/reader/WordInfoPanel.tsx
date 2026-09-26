import React from 'react';
import { Button, Alert, Form, Spinner } from 'react-bootstrap';
import type { LanguageConfig } from '../../utils/readerText';
import type { DisplayedWord } from '../../types/displayedWord';
import { WORD_STATUS_LABELS, WORD_STATUS_VALUES, type WordStatus } from '../../types/wordStatus';
import WiktionaryDefinitions from './WiktionaryDefinitions';

export type { DisplayedWord };

// LanguageConfig from readerText only covers tokenization; the API LanguageDto
// also carries `dictionaries` used by the embedded-dictionary buttons.
export type WordInfoLanguageConfig =
  | (NonNullable<LanguageConfig> & {
      dictionaries?: Array<{
        dictionaryId?: number;
        isActive?: boolean;
        purpose?: string;
        displayType?: string;
        urlTemplate?: string;
        sortOrder?: number;
      }>;
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
  onMineSentence: () => void;
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
  setEmbeddedUrl: (url: string | null) => void;
};

// Optional rich Wiktionary definitions; enabled only when the user's word translation
// provider is Wiktionary and rich display is turned on.
export type WordInfoDefinitionState = {
  enabled: boolean;
  sourceLanguageCode: string;
};

export type WordInfoPanelProps = {
  displayedWord: DisplayedWord | null;
  selectedWord: string;
  saveSuccess: boolean;
  translation: WordInfoTranslationState;
  speech: WordInfoSpeechState;
  actions: WordInfoActions;
  bookmark: WordInfoBookmarkState;
  language: WordInfoLanguageState;
  definition?: WordInfoDefinitionState;
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
  definition
}: WordInfoPanelProps) => {
  if (!displayedWord) {
    return (
      <div className="word-info-panel">
        <p className="mb-1">Click/hover on a word.</p>
        <p className="word-info-hint mb-0">Hover a word and press 1–5 to set its status, or I to ignore it.</p>
      </div>
    );
  }
  const status = displayedWord.status ?? 0;
  // Not `isNew`: the API also sets that on saved words of status 1.
  const isTracked = status > 0 && !!displayedWord.wordId;
  const statusButtonsDisabled = actions.processingWord || translation.isTranslating || !selectedWord;
  const hasUnsavedTranslation = isTracked && translation.saved !== undefined
    && translation.value.trim() !== translation.saved.trim();
  // Grow with the text (long Wiktionary glosses, appended AI senses) instead of scrolling a 2-line box.
  const translationRows = Math.min(6, Math.max(2, Math.ceil(translation.value.length / 40), translation.value.split(/\r?\n/).length));
  const termDictionaries = (language.languageConfig?.dictionaries ?? [])
    .filter(dict => dict.isActive && dict.purpose === 'terms')
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  let hint: React.ReactNode = null;
  if (translation.isTranslating) {
    hint = <><Spinner size="sm" className="me-1" />Translating…</>;
  } else if (hasUnsavedTranslation) {
    hint = <span className="word-info-hint-unsaved">Unsaved edit. Press Enter to save it.</span>;
  } else if (!isTracked && translation.value.trim()) {
    hint = 'Not saved yet. Pick a status, or press Enter to save it as New.';
  }

  return (
    <div className="word-info-panel">
      <div className="word-info-header">
        <h5 className="word-info-term">{displayedWord.term}</h5>
        <div className="word-info-meta">
          <span className="word-info-status-pill" data-status={status}>{statusLabel(status)}</span>
          {saveSuccess && <span className="word-info-saved" role="status">✓ Saved</span>}
        </div>
      </div>
      <Form.Control
        as="textarea"
        rows={translationRows}
        value={translation.value}
        onChange={(e) => translation.setValue(e.target.value)}
        onKeyDown={translation.onKeyDown}
        placeholder="Translation/Notes (Enter to save)"
        aria-label="Translation"
        disabled={translation.isTranslating}
        size="sm"
      />
      {hint && <div className="word-info-hint" aria-live="polite">{hint}</div>}
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
            onClick={() => actions.onSaveWord(s)}
            disabled={statusButtonsDisabled}
            title={`${WORD_STATUS_LABELS[s]} (key ${s} on a hovered word)`}
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
      <div className="d-flex flex-wrap gap-1 mt-2 word-info-actions">
        {actions.onRetranslateWithContext && (
          <Button
            variant="outline-primary"
            size="sm"
            className="py-0 px-2"
            onClick={actions.onRetranslateWithContext}
            disabled={!actions.canRetranslate || translation.isTranslating || actions.processingWord}
            title="Re-translate this word with AI using the current sentence as context"
          >
            {translation.isTranslating ? 'Translating...' : 'AI Translate'}
          </Button>
        )}
        {actions.onAddTranslationWithContext && (
          <Button
            variant="outline-primary"
            size="sm"
            className="py-0 px-2"
            onClick={actions.onAddTranslationWithContext}
            disabled={!actions.canAddTranslation || translation.isTranslating || actions.processingWord}
            title="Add an AI translation alongside the existing one"
            aria-label="Add AI translation"
          >
            + AI
          </Button>
        )}
        {speech.sentenceTtsEnabled && (
          <Button
            variant="outline-primary"
            size="sm"
            className="py-0 px-2"
            onClick={speech.onSpeakWord}
            disabled={!speech.canUseSentenceTts || !displayedWord?.term}
            title={speech.canUseSentenceTts ? 'Read this word aloud' : 'Speech synthesis is not supported in this browser'}
          >
            {speech.isSpeakingWord ? 'Speaking...' : 'Speak'}
          </Button>
        )}
        <Button
          variant="outline-success"
          size="sm"
          className="py-0 px-2"
          onClick={actions.onMineSentence}
          disabled={!isTracked}
          title="Mine the current sentence for SRS review"
        >
          Mine
        </Button>
        {bookmark.onToggleBookmark && (
          <Button
            variant={bookmark.isSentenceBookmarked ? 'warning' : 'outline-warning'}
            size="sm"
            className="py-0 px-2"
            onClick={bookmark.onToggleBookmark}
            title={bookmark.isSentenceBookmarked ? 'Remove bookmark from this sentence' : 'Bookmark this sentence'}
            aria-pressed={bookmark.isSentenceBookmarked}
          >
            🔖
          </Button>
        )}
        {displayedWord?.wordId && !displayedWord?.isNew && (displayedWord?.status ?? 0) >= 3 && (displayedWord?.status ?? 0) <= 4 && actions.onReadingCredit && (
          <Button
            variant="outline-info"
            size="sm"
            className="py-0 px-2"
            onClick={() => actions.onReadingCredit!(displayedWord.wordId!)}
            title="Boost SRS interval (reading credit)"
          >
            SRS ✓
          </Button>
        )}
        {/* Kept apart from the everyday actions so it isn't hit by accident. */}
        {actions.onDeleteWord && displayedWord?.wordId && (
          <Button
            variant="outline-danger"
            size="sm"
            className="py-0 px-2 ms-auto"
            onClick={actions.onDeleteWord}
            disabled={actions.processingWord || translation.isTranslating}
            title="Delete this term"
          >
            Delete
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

      {termDictionaries.length > 0 && selectedWord && (
        <div className="mt-3 pt-2 border-top">
          <h6 className="mb-2 small text-muted">Dictionaries</h6>
          <div className="d-flex flex-wrap gap-1">
            {termDictionaries.map(dict => {
              const urlTemplate = dict.urlTemplate ?? '';
              const handleDictClick = () => {
                if (!selectedWord) return;
                const term = encodeURIComponent(selectedWord);
                const url = urlTemplate.replace('###', term);
                if (dict.displayType === 'popup') {
                  window.open(url, '_blank', 'noopener,noreferrer');
                  language.setEmbeddedUrl(null);
                } else if (dict.displayType === 'embedded') {
                  language.setEmbeddedUrl(url);
                }
              };
              let buttonText = `Dict ${dict.sortOrder}`;
              try {
                const urlObj = new URL(urlTemplate);
                buttonText = urlObj.hostname.replace(/^www\./, '').split('.')[0];
                buttonText = buttonText.charAt(0).toUpperCase() + buttonText.slice(1);
              } catch {
                // Ignore invalid URL for naming
              }

              return (
                <Button key={dict.dictionaryId} variant="outline-info" size="sm" onClick={handleDictClick} title={dict.urlTemplate}>
                  {buttonText}
                </Button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

WordInfoPanel.displayName = 'WordInfoPanel';

export default WordInfoPanel;
