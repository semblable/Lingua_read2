import React from 'react';
import { Form } from 'react-bootstrap';
import type { Settings } from '../../contexts/SettingsContext';
import type { SettingsChangeHandler } from './AppearanceSettings';
import SecretKeyField from './SecretKeyField';

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
  onSaveProviderKey: (field: string, value: string) => Promise<void> | void;
  onClearProviderKey: (field: string) => Promise<void> | void;
}

const ReadingSettings = ({
  settings,
  handleChange,
  languages,
  loadingLanguages,
  onSaveProviderKey,
  onClearProviderKey
}: ReadingSettingsProps) => {
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

        <Form.Group className="mb-3" controlId="translationTargetLanguageCode">
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

        <Form.Group className={settings.wordTranslationProvider === 'deepl' ? 'mb-0' : 'mb-3'} controlId="wordTranslationProvider">
          <Form.Label>Word Translation Provider</Form.Label>
          <Form.Select
            name="wordTranslationProvider"
            value={settings.wordTranslationProvider}
            onChange={handleChange}
          >
            <option value="deepl">DeepL</option>
            <option value="wiktionary">Wiktionary (free, no API key)</option>
            <option value="azure">Azure Translator</option>
            <option value="google">Google Translate</option>
          </Form.Select>
          <Form.Text className="text-muted">
            Provider for single-word lookups in the reader. Wiktionary returns English
            dictionary definitions and works per word (sentence context is not used).
            Sentence and full-text translation always use your AI provider.
          </Form.Text>
        </Form.Group>

        {settings.wordTranslationProvider === 'wiktionary' && (
          <>
            <Form.Group className="mb-3" controlId="wiktionaryRichDisplay">
              <Form.Check
                type="switch"
                name="wiktionaryRichDisplay"
                label="Show rich Wiktionary definitions (part of speech + multiple senses)"
                checked={settings.wiktionaryRichDisplay}
                onChange={handleChange}
              />
              <Form.Text className="text-muted">
                When off, a single combined gloss is shown, just like DeepL.
              </Form.Text>
            </Form.Group>

            <SecretKeyField
              controlId="wiktionaryAccessToken"
              label="Wiktionary Access Token (optional)"
              field="wiktionaryAccessToken"
              hasValue={settings.hasWiktionaryAccessToken}
              onSave={onSaveProviderKey}
              onClear={onClearProviderKey}
              placeholder="Leave blank to use Wiktionary anonymously"
              className="mb-0"
              helpText={
                <>
                  A Wikimedia OAuth 2.0 access token raises the lookup rate limit from ~5 to ~10
                  requests/second, which helps when translating many words at once. Create one at{' '}
                  <a href="https://api.wikimedia.org/wiki/Authentication" target="_blank" rel="noopener noreferrer">
                    api.wikimedia.org
                  </a>{' '}
                  (an owner-only client is enough). Leave blank to stay anonymous.
                </>
              }
            />
          </>
        )}

        {settings.wordTranslationProvider === 'azure' && (
          <>
            <SecretKeyField
              controlId="azureTranslatorKey"
              label="Azure Translator Key"
              field="azureTranslatorKey"
              hasValue={settings.hasAzureTranslatorKey}
              onSave={onSaveProviderKey}
              onClear={onClearProviderKey}
              placeholder="Your Azure Translator subscription key"
              helpText={
                <>
                  A key from an Azure AI Translator resource. Create one in the{' '}
                  <a href="https://portal.azure.com/" target="_blank" rel="noopener noreferrer">
                    Azure portal
                  </a>{' '}
                  (a free tier is available). Leave blank to use the server-configured key, if any.
                </>
              }
            />

            <Form.Group className="mb-0" controlId="azureTranslatorRegion">
              <Form.Label>Azure Translator Region (optional)</Form.Label>
              <Form.Control
                type="text"
                name="azureTranslatorRegion"
                value={settings.azureTranslatorRegion}
                onChange={handleChange}
                placeholder="e.g. westeurope"
                autoComplete="off"
              />
              <Form.Text className="text-muted">
                Required for a regional Azure resource (matches your resource's location). Leave
                blank for a global resource.
              </Form.Text>
            </Form.Group>
          </>
        )}

        {settings.wordTranslationProvider === 'google' && (
          <SecretKeyField
            controlId="googleTranslateApiKey"
            label="Google Translate API Key"
            field="googleTranslateApiKey"
            hasValue={settings.hasGoogleTranslateApiKey}
            onSave={onSaveProviderKey}
            onClear={onClearProviderKey}
            placeholder="Your Google Cloud Translation API key"
            className="mb-0"
            helpText={
              <>
                A Google Cloud Translation (v2) API key. Create one in the{' '}
                <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">
                  Google Cloud console
                </a>{' '}
                with the Cloud Translation API enabled. Leave blank to use the server-configured key,
                if any.
              </>
            }
          />
        )}
      </div>
    </>
  );
};

export default ReadingSettings;
