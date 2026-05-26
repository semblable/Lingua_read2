import React from 'react';
import { Form } from 'react-bootstrap';
import type { Settings } from '../../contexts/SettingsContext';
import type { SettingsChangeHandler } from './AppearanceSettings';

interface LanguageOption {
  languageId: number;
  name: string;
  code?: string | null;
}

interface ReadingSettingsProps {
  settings: Settings;
  handleChange: SettingsChangeHandler;
  languages: LanguageOption[];
  loadingLanguages: boolean;
}

const ReadingSettings = ({ settings, handleChange, languages, loadingLanguages }: ReadingSettingsProps) => {
  return (
    <>
      <div className="settings-control-group">
        <Form.Group className="mb-3" controlId="autoTranslateWords">
          <Form.Check
            type="switch"
            name="autoTranslateWords"
            label="Automatically translate words when clicked"
            checked={settings.autoTranslateWords}
            onChange={handleChange}
          />
        </Form.Group>

        <Form.Group className="mb-3" controlId="autoTranslateOnOpen">
          <Form.Check
            type="switch"
            name="autoTranslateOnOpen"
            label="Automatically translate all unknown words when opening a text"
            checked={settings.autoTranslateOnOpen}
            onChange={handleChange}
          />
        </Form.Group>

        <Form.Group className="mb-3" controlId="pauseOnWordClick">
          <Form.Check
            type="switch"
            name="pauseOnWordClick"
            label="Pause audio when a word or phrase is opened"
            checked={settings.pauseOnWordClick}
            onChange={handleChange}
          />
        </Form.Group>

        <Form.Group className="mb-3" controlId="autoAdvanceAudiobookTracks">
          <Form.Check
            type="switch"
            name="autoAdvanceAudiobookTracks"
            label="Automatically play the next audiobook track when the current one ends"
            checked={settings.autoAdvanceAudiobookTracks}
            onChange={handleChange}
          />
        </Form.Group>

        <Form.Group className="mb-3" controlId="highlightKnownWords">
          <Form.Check
            type="switch"
            name="highlightKnownWords"
            label="Highlight words based on knowledge level"
            checked={settings.highlightKnownWords}
            onChange={handleChange}
          />
        </Form.Group>

        <Form.Group className="mb-3" controlId="tooltipOnlyForSavedWords">
          <Form.Check
            type="switch"
            name="tooltipOnlyForSavedWords"
            label="Only show hover tooltip for saved words (skip Word Info panel)"
            checked={settings.tooltipOnlyForSavedWords}
            onChange={handleChange}
          />
          <Form.Text className="text-muted">
            New (unsaved) words and multi-word phrases still open the Word Info panel.
          </Form.Text>
        </Form.Group>

        <Form.Group className="mb-0" controlId="sentenceTtsEnabled">
          <Form.Check
            type="switch"
            name="sentenceTtsEnabled"
            label="Enable browser text-to-speech controls in the reader"
            checked={settings.sentenceTtsEnabled}
            onChange={handleChange}
          />
        </Form.Group>
      </div>

      <div className="settings-control-group">
        <Form.Group className="mb-3" controlId="defaultLanguageId">
          <Form.Label>Default Language for New Texts</Form.Label>
          <Form.Select
            name="defaultLanguageId"
            value={settings.defaultLanguageId}
            onChange={handleChange}
            disabled={loadingLanguages}
          >
            <option value={0}>No default (ask each time)</option>
            {languages.map((language: LanguageOption) => (
              <option key={language.languageId} value={language.languageId}>
                {language.name}
              </option>
            ))}
          </Form.Select>
        </Form.Group>

        <Form.Group className="mb-0" controlId="translationTargetLanguageCode">
          <Form.Label>Translation Target Language</Form.Label>
          <Form.Select
            name="translationTargetLanguageCode"
            value={settings.translationTargetLanguageCode}
            onChange={handleChange}
            disabled={loadingLanguages}
          >
            <option value="EN">English</option>
            {languages
              .filter((language: LanguageOption) => language.code && language.code.toLowerCase() !== 'en')
              .map((language: LanguageOption) => (
                <option key={`target-${language.languageId}`} value={(language.code as string).toUpperCase()}>
                  {language.name}
                </option>
              ))}
          </Form.Select>
          <Form.Text className="text-muted">
            Used for word and sentence translation results in the reader.
          </Form.Text>
        </Form.Group>
      </div>
    </>
  );
};

export default ReadingSettings;
