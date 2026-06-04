import React from 'react';
import { Button, Alert, Form, Spinner } from 'react-bootstrap';
import type { LanguageConfig } from '../../utils/readerText';
import type { DisplayedWord } from '../../types/displayedWord';
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
  if (!displayedWord) return <p>Click/hover on a word.</p>;
  return (
    <div>
      <div className="mb-2">
        <h5 className="fw-bold mb-0">{displayedWord.term}</h5>
      </div>
      {saveSuccess && <Alert variant="success" className="py-1 px-2 small">Saved!</Alert>}
      <p className="mb-1 small">Status: {(displayedWord.status ?? 0) > 0 ? ['New', 'Learning', 'Familiar', 'Advanced', 'Known', 'Ignored'][(displayedWord.status ?? 1) - 1] : 'Untracked'}</p>
      <Form.Control
        as="textarea"
        rows={2}
        value={translation.value}
        onChange={(e) => translation.setValue(e.target.value)}
        onKeyDown={translation.onKeyDown}
        placeholder="Translation/Notes (Enter to save)"
        disabled={translation.isTranslating}
        size="sm"
      />
      {translation.isTranslating && <Spinner size="sm" />}
      {translation.error && <Alert variant="danger" className="py-1 px-2 small">{translation.error}</Alert>}
      <div className="d-flex flex-wrap gap-1 mt-2 word-status-row">
        {[1, 2, 3, 4, 5].map(s => (
          <Button
            key={s}
            variant="outline-secondary"
            size="sm"
            className="py-0 px-2 word-status-btn"
            onClick={() => actions.onSaveWord(s)}
            disabled={actions.processingWord || translation.isTranslating || !selectedWord}
          >
            {s}
          </Button>
        ))}
        <Button
          variant="outline-secondary"
          size="sm"
          className="py-0 px-2 word-status-btn"
          onClick={() => actions.onSaveWord(6)}
          disabled={actions.processingWord || translation.isTranslating || !selectedWord}
          title="Ignore this word — excluded from stats and reviews"
        >
          Ignore
        </Button>
      </div>
      <div className="d-flex flex-wrap gap-1 mt-2">
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
          disabled={!displayedWord?.wordId || displayedWord?.isNew}
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
        {actions.onDeleteWord && displayedWord?.wordId && (
          <Button
            variant="outline-danger"
            size="sm"
            className="py-0 px-2"
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

      {language.languageConfig?.dictionaries && selectedWord && (
        <div className="mt-3 pt-2 border-top">
          <h6 className="mb-2 small text-muted">Dictionaries</h6>
          <div className="d-flex flex-wrap gap-1">
            {language.languageConfig.dictionaries
              .filter(dict => dict.isActive && dict.purpose === 'terms')
              .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
              .map(dict => {
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
