import React from 'react';
import { Button, Alert, Form, Spinner } from 'react-bootstrap';
import type { LanguageConfig } from '../../utils/readerText';

// A "displayed/selected word" is the TextDisplay-side accumulation of fields
// from API word records plus local UI flags. Shape varies; the union below
// names the most-accessed fields without locking out extras.
export type DisplayedWord = {
  wordId?: number | string;
  term?: string;
  translation?: string;
  status?: number;
  isNew?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

// The 25-prop interface drilled down from pages/TextDisplay. Grouped by
// concern in comments. Phase E3 will consider extracting these into a
// composite type or a ReaderContext; for now the explicit shape is the
// contract.
export type WordInfoPanelProps = {
  // Word display / status
  displayedWord: DisplayedWord | null;
  saveSuccess: boolean;

  // Translation state
  translation: string;
  setTranslation: (value: string) => void;
  handleTranslationKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  isTranslating: boolean;
  wordTranslationError: string | null;

  // Word-status actions
  handleSaveWord: (status: number) => void | Promise<void>;
  processingWord: boolean;
  // The currently-selected term string (TextDisplay state).
  selectedWord: string;

  // Reading-language config + embed. LanguageConfig from readerText only covers
  // tokenization; the API LanguageDto also carries `dictionaries`. Augment here.
  languageConfig: LanguageConfig & {
    dictionaries?: Array<{
      dictionaryId?: number;
      isActive?: boolean;
      purpose?: string;
      displayType?: string;
      urlTemplate?: string;
      sortOrder?: number;
    }>;
  };
  setEmbeddedUrl: (url: string | null) => void;

  // Speech / TTS
  sentenceTtsEnabled: boolean;
  canUseSentenceTts: boolean;
  isSpeakingWord: boolean;
  onSpeakWord: () => void;

  // SRS / sentence actions
  handleMineSentence: () => void;
  onReadingCredit?: (wordId: number | string) => void;
  onRetranslateWithContext?: () => void;
  canRetranslate?: boolean;
  onAddTranslationWithContext?: () => void;
  canAddTranslation?: boolean;
  onDeleteWord?: () => void;

  // Bookmarks
  isSentenceBookmarked: boolean;
  onToggleBookmark: () => void;
};

const WordInfoPanel = React.memo(({
  displayedWord,
  saveSuccess,
  translation,
  setTranslation,
  handleTranslationKeyDown,
  isTranslating,
  wordTranslationError,
  handleSaveWord,
  processingWord,
  selectedWord,
  languageConfig,
  setEmbeddedUrl,
  sentenceTtsEnabled,
  canUseSentenceTts,
  isSpeakingWord,
  onSpeakWord,
  handleMineSentence,
  onReadingCredit,
  onRetranslateWithContext,
  canRetranslate,
  onAddTranslationWithContext,
  canAddTranslation,
  onDeleteWord,
  isSentenceBookmarked,
  onToggleBookmark
}: WordInfoPanelProps) => {
  if (!displayedWord) return <p>Click/hover on a word.</p>;
  return (
    <div>
      <div className="mb-2">
        <h5 className="fw-bold mb-0">{displayedWord.term}</h5>
      </div>
      {saveSuccess && <Alert variant="success" className="py-1 px-2 small">Saved!</Alert>}
      <p className="mb-1 small">Status: {displayedWord.status > 0 ? ['New', 'Learning', 'Familiar', 'Advanced', 'Known'][displayedWord.status - 1] : 'Untracked'}</p>
      <Form.Control
        as="textarea"
        rows={2}
        value={translation}
        onChange={(e) => setTranslation(e.target.value)}
        onKeyDown={handleTranslationKeyDown}
        placeholder="Translation/Notes (Enter to save)"
        disabled={isTranslating}
        size="sm"
      />
      {isTranslating && <Spinner size="sm" />}
      {wordTranslationError && <Alert variant="danger" className="py-1 px-2 small">{wordTranslationError}</Alert>}
      <div className="d-flex flex-wrap gap-1 mt-2 word-status-row">
        {[1, 2, 3, 4, 5].map(s => (
          <Button
            key={s}
            variant="outline-secondary"
            size="sm"
            className="py-0 px-2 word-status-btn"
            onClick={() => handleSaveWord(s)}
            disabled={processingWord || isTranslating || !selectedWord}
          >
            {s}
          </Button>
        ))}
      </div>
      <div className="d-flex flex-wrap gap-1 mt-2">
        {onRetranslateWithContext && (
          <Button
            variant="outline-primary"
            size="sm"
            className="py-0 px-2"
            onClick={onRetranslateWithContext}
            disabled={!canRetranslate || isTranslating || processingWord}
            title="Re-translate this word with AI using the current sentence as context"
          >
            {isTranslating ? 'Translating...' : 'AI Translate'}
          </Button>
        )}
        {onAddTranslationWithContext && (
          <Button
            variant="outline-primary"
            size="sm"
            className="py-0 px-2"
            onClick={onAddTranslationWithContext}
            disabled={!canAddTranslation || isTranslating || processingWord}
            title="Add an AI translation alongside the existing one"
            aria-label="Add AI translation"
          >
            + AI
          </Button>
        )}
        {sentenceTtsEnabled && (
          <Button
            variant="outline-primary"
            size="sm"
            className="py-0 px-2"
            onClick={onSpeakWord}
            disabled={!canUseSentenceTts || !displayedWord?.term}
            title={canUseSentenceTts ? 'Read this word aloud' : 'Speech synthesis is not supported in this browser'}
          >
            {isSpeakingWord ? 'Speaking...' : 'Speak'}
          </Button>
        )}
        <Button
          variant="outline-success"
          size="sm"
          className="py-0 px-2"
          onClick={handleMineSentence}
          disabled={!displayedWord?.wordId || displayedWord?.isNew}
          title="Mine the current sentence for SRS review"
        >
          Mine
        </Button>
        {onToggleBookmark && (
          <Button
            variant={isSentenceBookmarked ? 'warning' : 'outline-warning'}
            size="sm"
            className="py-0 px-2"
            onClick={onToggleBookmark}
            title={isSentenceBookmarked ? 'Remove bookmark from this sentence' : 'Bookmark this sentence'}
          >
            🔖
          </Button>
        )}
        {displayedWord?.wordId && !displayedWord?.isNew && displayedWord?.status >= 3 && displayedWord?.status <= 4 && (
          <Button
            variant="outline-info"
            size="sm"
            className="py-0 px-2"
            onClick={() => onReadingCredit(displayedWord.wordId)}
            title="Boost SRS interval (reading credit)"
          >
            SRS ✓
          </Button>
        )}
        {onDeleteWord && displayedWord?.wordId && (
          <Button
            variant="outline-danger"
            size="sm"
            className="py-0 px-2"
            onClick={onDeleteWord}
            disabled={processingWord || isTranslating}
            title="Delete this term"
          >
            Delete
          </Button>
        )}
      </div>

      {languageConfig?.dictionaries && selectedWord && (
        <div className="mt-3 pt-2 border-top">
          <h6 className="mb-2 small text-muted">Dictionaries</h6>
          <div className="d-flex flex-wrap gap-1">
            {languageConfig.dictionaries
              .filter(dict => dict.isActive && dict.purpose === 'terms')
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map(dict => {
                const handleDictClick = () => {
                  if (!selectedWord) return;
                  const term = encodeURIComponent(selectedWord);
                  const url = dict.urlTemplate.replace('###', term);
                  if (dict.displayType === 'popup') {
                    window.open(url, '_blank', 'noopener,noreferrer');
                    setEmbeddedUrl(null);
                  } else if (dict.displayType === 'embedded') {
                    setEmbeddedUrl(url);
                  }
                };
                let buttonText = `Dict ${dict.sortOrder}`;
                try {
                  const urlObj = new URL(dict.urlTemplate);
                  buttonText = urlObj.hostname.replace(/^www\./, '').split('.')[0];
                  buttonText = buttonText.charAt(0).toUpperCase() + buttonText.slice(1);
                } catch (e) {
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

export default WordInfoPanel;
