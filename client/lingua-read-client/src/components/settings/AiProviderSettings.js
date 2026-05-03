import React from 'react';
import { Form, Button, Alert } from 'react-bootstrap';

const AiProviderSettings = ({
  settings,
  handleChange,
  testingOpenRouter,
  openRouterTestResult,
  onTestConnection
}) => {
  return (
    <>
      <div className="settings-control-group">
        <Form.Group className="mb-0" controlId="useOpenRouter">
          <Form.Check
            type="switch"
            name="useOpenRouter"
            label="Use OpenRouter instead of Gemini for translation and story generation"
            checked={settings.useOpenRouter}
            onChange={handleChange}
          />
          <Form.Text className="text-muted">
            OpenRouter provides access to multiple AI models. You'll need an API key from openrouter.ai.
          </Form.Text>
        </Form.Group>
      </div>

      {settings.useOpenRouter && (
        <>
          <div className="settings-control-group">
            <Form.Group className="mb-3" controlId="openRouterApiKey">
              <Form.Label>OpenRouter API Key</Form.Label>
              <Form.Control
                type="password"
                name="openRouterApiKey"
                autoComplete="off"
                placeholder="sk-or-..."
                value={settings.openRouterApiKey}
                onChange={handleChange}
              />
              <Form.Text className="text-muted">
                Get your API key from <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">openrouter.ai/keys</a>
              </Form.Text>
            </Form.Group>

            <Form.Group className="mb-0" controlId="openRouterModel">
              <Form.Label>Model Name</Form.Label>
              <Form.Control
                type="text"
                name="openRouterModel"
                placeholder="google/gemini-2.5-flash-preview-05-20:free"
                value={settings.openRouterModel}
                onChange={handleChange}
              />
              <Form.Text className="text-muted">
                Paste any model name from <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer">openrouter.ai/models</a>. Free models end with ":free".
              </Form.Text>
            </Form.Group>
          </div>

          <div className="settings-control-group">
            <small className="text-muted d-block mb-2 fw-bold">Translation Reasoning</small>
            <Form.Group className="mb-3" controlId="openRouterReasoningEnabled">
              <Form.Check
                type="switch"
                name="openRouterReasoningEnabled"
                label="Enable reasoning tokens for translations"
                checked={settings.openRouterReasoningEnabled}
                onChange={handleChange}
              />
            </Form.Group>

            <Form.Group className="mb-0" controlId="openRouterReasoningEffort">
              <Form.Label>Translation Reasoning Effort</Form.Label>
              <Form.Select
                name="openRouterReasoningEffort"
                value={settings.openRouterReasoningEffort}
                onChange={handleChange}
                disabled={!settings.openRouterReasoningEnabled}
              >
                <option value="xhigh">xhigh</option>
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
                <option value="minimal">minimal</option>
                <option value="none">none</option>
              </Form.Select>
              <Form.Text className="text-muted">
                Sent as reasoning.effort to OpenRouter for translations.
              </Form.Text>
            </Form.Group>
          </div>

          <div className="settings-control-group">
            <small className="text-muted d-block mb-2 fw-bold">Story Generation Reasoning</small>
            <Form.Group className="mb-3" controlId="openRouterStoryReasoningEnabled">
              <Form.Check
                type="switch"
                name="openRouterStoryReasoningEnabled"
                label="Enable reasoning tokens for story generation"
                checked={settings.openRouterStoryReasoningEnabled}
                onChange={handleChange}
              />
            </Form.Group>

            <Form.Group className="mb-0" controlId="openRouterStoryReasoningEffort">
              <Form.Label>Story Generation Reasoning Effort</Form.Label>
              <Form.Select
                name="openRouterStoryReasoningEffort"
                value={settings.openRouterStoryReasoningEffort}
                onChange={handleChange}
                disabled={!settings.openRouterStoryReasoningEnabled}
              >
                <option value="xhigh">xhigh</option>
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
                <option value="minimal">minimal</option>
                <option value="none">none</option>
              </Form.Select>
              <Form.Text className="text-muted">
                Sent as reasoning.effort to OpenRouter for story generation.
              </Form.Text>
            </Form.Group>
          </div>

          <div className="settings-control-group">
            <small className="text-muted d-block mb-2 fw-bold">Per-task model & prompt overrides</small>
            <Form.Text className="text-muted d-block mb-3">
              Leave a model field empty to fall back to the default model above. Leave a prompt
              field empty to use the built-in template. Prompts support placeholders like{' '}
              <code>{'{text}'}</code>, <code>{'{sourceLanguage}'}</code>,{' '}
              <code>{'{targetLanguage}'}</code>, <code>{'{explanationLanguage}'}</code>,{' '}
              <code>{'{maxSummaryWords}'}</code>, <code>{'{level}'}</code>,{' '}
              <code>{'{language}'}</code>, <code>{'{prompt}'}</code>, <code>{'{maxLength}'}</code>,{' '}
              <code>{'{selectedText}'}</code>, <code>{'{sentenceContext}'}</code>.
              Note: full-text translation always uses the structural tagged template (custom
              translation prompts apply only to single-sentence and selection translations).
            </Form.Text>

            {[
              {
                key: 'Translation',
                label: 'Translation (sentence + selection)',
                modelName: 'openRouterTranslationModel',
                promptName: 'customTranslationPrompt'
              },
              {
                key: 'Explanation',
                label: 'Sentence explanation',
                modelName: 'openRouterExplanationModel',
                promptName: 'customExplanationPrompt'
              },
              {
                key: 'Story',
                label: 'Story generation',
                modelName: 'openRouterStoryModel',
                promptName: 'customStoryPrompt'
              },
              {
                key: 'Summarization',
                label: 'Summarization',
                modelName: 'openRouterSummarizationModel',
                promptName: 'customSummarizationPrompt'
              }
            ].map(task => (
              <div key={task.key} className="mb-3 pb-3 border-bottom">
                <Form.Group className="mb-2" controlId={task.modelName}>
                  <Form.Label className="mb-1">{task.label} — model</Form.Label>
                  <Form.Control
                    type="text"
                    name={task.modelName}
                    placeholder="(use default model above)"
                    value={settings[task.modelName] || ''}
                    onChange={handleChange}
                  />
                </Form.Group>
                <Form.Group className="mb-0" controlId={task.promptName}>
                  <Form.Label className="mb-1">{task.label} — custom prompt</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    name={task.promptName}
                    placeholder="(leave empty to use built-in default)"
                    value={settings[task.promptName] || ''}
                    onChange={handleChange}
                    style={{ fontFamily: 'monospace', fontSize: '0.85em' }}
                  />
                </Form.Group>
              </div>
            ))}
          </div>

          <div className="settings-control-group">
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={onTestConnection}
              disabled={testingOpenRouter || !settings.openRouterApiKey}
            >
              {testingOpenRouter ? 'Testing...' : 'Test Connection'}
            </Button>
            {openRouterTestResult && (
              <Alert
                variant={openRouterTestResult.success ? 'success' : 'danger'}
                className="mt-2 mb-0"
                style={{ fontSize: '0.9em' }}
              >
                <strong>{openRouterTestResult.success ? '\u2713' : '\u2717'}</strong> {openRouterTestResult.message}
                {openRouterTestResult.details && (
                  <div className="mt-1" style={{ fontSize: '0.85em', opacity: 0.8 }}>
                    {openRouterTestResult.details.substring(0, 200)}
                  </div>
                )}
              </Alert>
            )}
          </div>
        </>
      )}
    </>
  );
};

export default AiProviderSettings;
