import React, { useState } from 'react';
import { Form, Button, Alert } from 'react-bootstrap';
import type { AiProviderConfig, Settings } from '../../contexts/SettingsContext';
import type { SettingsChangeHandler } from './AppearanceSettings';
import type { AiProviderInfo, AiProviderTestResult } from '../../utils/api/aiProviders';
import { getAiProviderModels } from '../../utils/api';
import SecretKeyField from './SecretKeyField';

const BUILT_IN_GEMINI = 'gemini';

type ModelField = 'model' | 'translationModel' | 'explanationModel' | 'storyModel' | 'summarizationModel';
export type AiProviderConfigField = ModelField | 'baseUrl';

const TASKS: ReadonlyArray<{ key: string; label: string; modelField: ModelField; promptName: string }> = [
  { key: 'Translation', label: 'Translation (sentence + selection)', modelField: 'translationModel', promptName: 'customTranslationPrompt' },
  { key: 'Explanation', label: 'Sentence explanation', modelField: 'explanationModel', promptName: 'customExplanationPrompt' },
  { key: 'Story', label: 'Story generation', modelField: 'storyModel', promptName: 'customStoryPrompt' },
  { key: 'Summarization', label: 'Summarization', modelField: 'summarizationModel', promptName: 'customSummarizationPrompt' }
];

const REASONING_EFFORTS = ['xhigh', 'high', 'medium', 'low', 'minimal', 'none'];

/**
 * What the provider still needs before AI requests go to it (the server falls back to the
 * built-in Gemini until then). Mirrors AiProviderConnection.TryCreate on the server.
 */
const missingProviderSetup = (
  provider: AiProviderInfo,
  config: AiProviderConfig | undefined,
  hasApiKey: boolean
): string[] => {
  const missing: string[] = [];
  if (provider.requiresBaseUrl && !config?.baseUrl?.trim()) missing.push('the server URL');
  if (!provider.apiKeyOptional && !hasApiKey) missing.push('an API key');
  const model = config?.model?.trim() || provider.defaultModel || '';
  if (TASKS.some(task => !config?.[task.modelField]?.trim() && !model)) missing.push('a model');
  return missing;
};

const joinWithAnd = (items: string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

interface AiProviderSettingsProps {
  settings: Settings;
  handleChange: SettingsChangeHandler;
  /** The catalog from GET /api/aiproviders; null while loading. */
  providers: AiProviderInfo[] | null;
  providersError: string;
  onProviderConfigChange: (provider: string, field: AiProviderConfigField, value: string) => void;
  onSaveApiKey: (provider: string, value: string) => Promise<void> | void;
  onClearApiKey: (provider: string) => Promise<void> | void;
  testingConnection: boolean;
  /** The last connection test, and which provider it was for. */
  testResult: { provider: string; result: AiProviderTestResult } | null;
  onTestConnection: (provider: string) => void;
  /** Saves any waiting change; resolves false when that failed. */
  saveNow: () => Promise<boolean>;
}

const AiProviderSettings = ({
  settings,
  handleChange,
  providers,
  providersError,
  onProviderConfigChange,
  onSaveApiKey,
  onClearApiKey,
  testingConnection,
  testResult: lastTest,
  onTestConnection,
  saveNow
}: AiProviderSettingsProps) => {
  // Model ids fetched from each provider, by provider id.
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsMessage, setModelsMessage] = useState<{ provider: string; text: string; error: boolean } | null>(null);

  const selectedId = settings.aiProvider || BUILT_IN_GEMINI;
  const provider = providers?.find(p => p.id === selectedId) ?? null;
  const config: AiProviderConfig = settings.aiProviders?.[selectedId] ?? {};
  const hasApiKey = (settings.aiProvidersWithApiKey ?? []).includes(selectedId);
  const missing = provider ? missingProviderSetup(provider, config, hasApiKey) : [];
  const providerModels = models[selectedId] ?? [];
  const datalistId = `ai-models-${selectedId}`;
  const testResult = lastTest?.provider === selectedId ? lastTest.result : null;

  // Keep a saved selection visible even if the catalog failed to load or no longer lists it.
  const options = [
    ...(providers ?? []).map(p => ({ id: p.id ?? '', name: p.displayName ?? p.id ?? '' })),
    ...(selectedId !== BUILT_IN_GEMINI && !provider ? [{ id: selectedId, name: selectedId }] : [])
  ];

  const loadModels = async () => {
    setModelsLoading(true);
    setModelsMessage(null);
    try {
      // The list is fetched with the saved key and URL, so a URL still waiting to save goes first.
      if (!(await saveNow())) {
        setModelsMessage({
          provider: selectedId,
          text: "Your latest changes aren't saved yet, so the list would use the old ones. Retry the save first.",
          error: true
        });
        return;
      }
      const result = await getAiProviderModels(selectedId);
      if (result.error) {
        setModelsMessage({ provider: selectedId, text: result.error, error: true });
      } else {
        const ids = result.models ?? [];
        setModels(current => ({ ...current, [selectedId]: ids }));
        setModelsMessage({
          provider: selectedId,
          text: ids.length ? `${ids.length} models loaded: pick one from the model fields' suggestions.` : 'The provider listed no models.',
          error: ids.length === 0
        });
      }
    } catch (e: unknown) {
      setModelsMessage({ provider: selectedId, text: (e instanceof Error && e.message) || 'Failed to load models.', error: true });
    } finally {
      setModelsLoading(false);
    }
  };

  const configInput = (field: ModelField | 'baseUrl') => ({
    value: config[field] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onProviderConfigChange(selectedId, field, e.target.value)
  });

  return (
    <>
      <div className="settings-control-group">
        <Form.Group className="mb-0" controlId="aiProvider">
          <Form.Label>AI provider</Form.Label>
          <Form.Select name="aiProvider" value={selectedId} onChange={handleChange}>
            <option value={BUILT_IN_GEMINI}>Built-in Gemini (server key)</option>
            {options.map(o => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </Form.Select>
          <Form.Text className="text-muted">
            Used for sentence and selection translation, sentence explanations, story generation and
            summaries. Each provider keeps its own key and models, so you can switch back and forth.
          </Form.Text>
        </Form.Group>
        {providersError && (
          <Alert variant="warning" className="mt-2 mb-0" style={{ fontSize: '0.9em' }}>
            Couldn't load the list of providers: {providersError}
          </Alert>
        )}
      </div>

      {selectedId !== BUILT_IN_GEMINI && provider && (
        <>
          {missing.length > 0 && (
            <Alert variant="warning" className="mb-3" style={{ fontSize: '0.9em' }} data-testid="ai-provider-incomplete">
              {provider.displayName} is not in use yet: add {joinWithAnd(missing)}. Until then, AI
              features use the built-in Gemini.
            </Alert>
          )}

          <div className="settings-control-group">
            {provider.requiresBaseUrl && (
              <Form.Group className="mb-3" controlId="aiBaseUrl">
                <Form.Label>Server URL</Form.Label>
                <Form.Control
                  type="url"
                  name="aiBaseUrl"
                  placeholder="http://localhost:11434/v1"
                  autoComplete="off"
                  {...configInput('baseUrl')}
                />
                <Form.Text className="text-muted">
                  The base URL of any server that speaks the OpenAI chat-completions API, e.g. Ollama
                  (<code>http://host:11434/v1</code>), LM Studio, vLLM, LiteLLM, Together or Fireworks.
                  The server calls it, so it must be reachable from the server.
                </Form.Text>
              </Form.Group>
            )}

            <SecretKeyField
              controlId={`aiApiKey-${selectedId}`}
              label={provider.apiKeyOptional ? `${provider.displayName} API key (optional)` : `${provider.displayName} API key`}
              field={selectedId}
              hasValue={hasApiKey}
              onSave={onSaveApiKey}
              onClear={onClearApiKey}
              placeholder={provider.keyPlaceholder ?? ''}
              helpText={provider.keysUrl ? (
                <>
                  Get your API key from{' '}
                  <a href={provider.keysUrl} target="_blank" rel="noopener noreferrer">
                    {provider.keysUrl.replace(/^https?:\/\//, '')}
                  </a>
                </>
              ) : undefined}
            />

            <Form.Group className="mb-0" controlId="aiModel">
              <Form.Label>Model</Form.Label>
              <Form.Control
                type="text"
                name="aiModel"
                list={datalistId}
                autoComplete="off"
                placeholder={provider.defaultModel ?? 'Model id, e.g. from "Load models"'}
                {...configInput('model')}
              />
              <datalist id={datalistId}>
                {providerModels.map(m => <option key={m} value={m} />)}
              </datalist>
              <div className="d-flex flex-wrap align-items-center gap-2 mt-2">
                <Button variant="outline-secondary" size="sm" type="button" onClick={loadModels} disabled={modelsLoading}>
                  {modelsLoading ? 'Loading models...' : 'Load models'}
                </Button>
                {modelsMessage?.provider === selectedId && (
                  <span className={`small ${modelsMessage.error ? 'text-danger' : 'text-muted'}`} role="status">
                    {modelsMessage.text}
                  </span>
                )}
              </div>
              <Form.Text className="text-muted d-block">
                {provider.defaultModel
                  ? <>Leave empty to use <code>{provider.defaultModel}</code>.</>
                  : 'Required.'}{' '}
                Load models lists what your saved key can use
                {provider.modelsUrl && (
                  <>
                    ; the provider's{' '}
                    <a href={provider.modelsUrl} target="_blank" rel="noopener noreferrer">model list</a>{' '}
                    describes them
                  </>
                )}
                .
              </Form.Text>
            </Form.Group>
          </div>

          {provider.supportsReasoning && (
            <>
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
                    {REASONING_EFFORTS.map(effort => <option key={effort} value={effort}>{effort}</option>)}
                  </Form.Select>
                  <Form.Text className="text-muted">
                    {selectedId === 'deepseek'
                      ? 'DeepSeek thinks by default; while this is off, translations ask it not to, which is faster and cheaper. xhigh is sent as max, medium as high, minimal as low.'
                      : 'Sent as reasoning.effort to OpenRouter for translations.'}
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
                    {REASONING_EFFORTS.map(effort => <option key={effort} value={effort}>{effort}</option>)}
                  </Form.Select>
                  <Form.Text className="text-muted">
                    {selectedId === 'deepseek'
                      ? 'Also used for summaries.'
                      : 'Sent as reasoning.effort to OpenRouter for story generation and summaries.'}
                  </Form.Text>
                </Form.Group>
              </div>
            </>
          )}

          <div className="settings-control-group">
            <small className="text-muted d-block mb-2 fw-bold">Per-task model & prompt overrides</small>
            <Form.Text className="text-muted d-block mb-3">
              Leave a model field empty to fall back to the model above. Model overrides belong to{' '}
              {provider.displayName}; prompts apply to every provider. Leave a prompt field empty to
              use the built-in template. Prompts support placeholders like{' '}
              <code>{'{text}'}</code>, <code>{'{sourceLanguage}'}</code>,{' '}
              <code>{'{targetLanguage}'}</code>, <code>{'{explanationLanguage}'}</code>,{' '}
              <code>{'{maxSummaryWords}'}</code>, <code>{'{level}'}</code>,{' '}
              <code>{'{language}'}</code>, <code>{'{prompt}'}</code>, <code>{'{maxLength}'}</code>,{' '}
              <code>{'{selectedText}'}</code>, <code>{'{sentenceContext}'}</code>.
              Note: full-text translation always uses the structural tagged template (custom
              translation prompts apply only to single-sentence and selection translations).
            </Form.Text>

            {TASKS.map(task => (
              <div key={task.key} className="mb-3 pb-3 border-bottom">
                <Form.Group className="mb-2" controlId={`ai${task.key}Model`}>
                  <Form.Label className="mb-1">{task.label} — model</Form.Label>
                  <Form.Control
                    type="text"
                    name={`ai${task.key}Model`}
                    list={datalistId}
                    autoComplete="off"
                    placeholder="(use the model above)"
                    {...configInput(task.modelField)}
                  />
                </Form.Group>
                <Form.Group className="mb-0" controlId={task.promptName}>
                  <Form.Label className="mb-1">{task.label} — custom prompt</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    name={task.promptName}
                    placeholder="(leave empty to use built-in default)"
                    value={(settings as unknown as Record<string, string>)[task.promptName] || ''}
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
              type="button"
              onClick={() => onTestConnection(selectedId)}
              disabled={testingConnection}
            >
              {testingConnection ? 'Testing...' : 'Test Connection'}
            </Button>
            {testResult && (
              <Alert
                variant={testResult.success ? 'success' : 'danger'}
                className="mt-2 mb-0"
                style={{ fontSize: '0.9em' }}
              >
                <strong>{testResult.success ? '✓' : '✗'}</strong> {testResult.message}
                {testResult.details && (
                  <div className="mt-1" style={{ fontSize: '0.85em', opacity: 0.8 }}>
                    {testResult.details.substring(0, 200)}
                  </div>
                )}
              </Alert>
            )}
          </div>
        </>
      )}

      {selectedId === BUILT_IN_GEMINI && (
        <div className="settings-control-group">
          <Form.Text className="text-muted d-block">
            The built-in Gemini uses the key configured on the server. Pick a provider above to use
            your own key, or a custom OpenAI-compatible server such as Ollama or LM Studio.
          </Form.Text>
        </div>
      )}
    </>
  );
};

export default AiProviderSettings;
