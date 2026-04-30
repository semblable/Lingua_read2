import React from 'react';
import { Button, Alert, Form, Spinner } from 'react-bootstrap';

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
  onDeleteWord,
  isSentenceBookmarked,
  onToggleBookmark
}) => {
  if (!displayedWord) return <p>Click/hover on a word.</p>;
  return (
    <div>
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
        <h5 className="fw-bold mb-0">{displayedWord.term}</h5>
        {sentenceTtsEnabled && (
          <Button
            variant="outline-primary"
            size="sm"
            onClick={onSpeakWord}
            disabled={!canUseSentenceTts || !displayedWord?.term}
            title={canUseSentenceTts ? 'Read this word aloud' : 'Speech synthesis is not supported in this browser'}
          >
            {isSpeakingWord ? 'Speaking...' : 'Speak Word'}
          </Button>
        )}
        <Button
          variant="outline-success"
          size="sm"
          onClick={handleMineSentence}
          disabled={!displayedWord?.wordId || displayedWord?.isNew}
          title="Mine the current sentence for SRS review"
        >
          Mine Sentence
        </Button>
        {onToggleBookmark && (
          <Button
            variant={isSentenceBookmarked ? 'warning' : 'outline-warning'}
            size="sm"
            onClick={onToggleBookmark}
            title={isSentenceBookmarked ? 'Remove bookmark from this sentence' : 'Bookmark this sentence'}
          >
            {isSentenceBookmarked ? '🔖 Bookmarked' : '🔖 Bookmark'}
          </Button>
        )}
        {displayedWord?.wordId && !displayedWord?.isNew && displayedWord?.status >= 3 && displayedWord?.status <= 4 && (
          <Button
            variant="outline-info"
            size="sm"
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
            onClick={onDeleteWord}
            disabled={processingWord || isTranslating}
            title="Delete this term"
          >
            Delete
          </Button>
        )}
      </div>
      {saveSuccess && <Alert variant="success" size="sm">Saved!</Alert>}
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
      {wordTranslationError && <Alert variant="danger" size="sm">{wordTranslationError}</Alert>}
      {onRetranslateWithContext && (
        <Button
          variant="outline-primary"
          size="sm"
          className="mt-2"
          onClick={onRetranslateWithContext}
          disabled={!canRetranslate || isTranslating || processingWord}
          title="Re-translate this word with AI using the current sentence as context"
        >
          {isTranslating ? 'Translating...' : 'AI Translate'}
        </Button>
      )}
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
