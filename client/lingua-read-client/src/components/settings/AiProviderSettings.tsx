import React, { useEffect, useMemo, useState } from 'react';
import { Form, Button, Alert } from 'react-bootstrap';
import { DISABLED_AI_PROVIDER } from '../../contexts/SettingsContext';
import type { AiProviderConfig, Settings } from '../../contexts/SettingsContext';
import type { SettingsChangeHandler } from './AppearanceSettings';
import type { AiProviderInfo, AiProviderTestResult } from '../../utils/api/aiProviders';
import { getAiProviderModels } from '../../utils/api';
import SecretKeyField from './SecretKeyField';

type ModelField = 'model' | 'translationModel' | 'explanationModel' | 'storyModel' | 'summarizationModel';
export type AiProviderConfigField = ModelField | 'baseUrl';

const TASKS: ReadonlyArray<{ key: string; label: string; modelField: ModelField }> = [
  { key: 'Translation', label: 'Translation (sentence + selection)', modelField: 'translationModel' },
  { key: 'Explanation', label: 'Sentence explanation', modelField: 'explanationModel' },
  { key: 'Story', label: 'Story generation', modelField: 'storyModel' },
  { key: 'Summarization', label: 'Summarization', modelField: 'summarizationModel' }
];

const REASONING_EFFORTS = ['xhigh', 'high', 'medium', 'low', 'minimal', 'none'];

/** What the provider needs before it can handle AI requests. */
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
  const [refreshByProvider, setRefreshByProvider] = useState<Record<string, number>>({});
  const selectedId = settings.aiProvider;
  const provider = providers?.find(p => p.id === selectedId) ?? null;
  const config: AiProviderConfig = settings.aiProviders?.[selectedId] ?? {};
  const savedKeys = settings.aiProvidersWithApiKey;
  const hasApiKey = savedKeys.includes(selectedId);
  const missing = provider ? missingProviderSetup(provider, config, hasApiKey) : [];
  const canUseKey = provider !== null && (provider.apiKeyOptional === true || hasApiKey === true);
  const requiresBaseUrl = provider?.requiresBaseUrl === true;
  const baseUrl = requiresBaseUrl ? config.baseUrl?.trim() : undefined;
  const canRefresh = canUseKey && (!requiresBaseUrl || !!baseUrl);
  const refresh = refreshByProvider[selectedId] ?? 0;
  const modelSource = useMemo(() => ({
    provider: selectedId, baseUrl, savedKeys, refresh
  }), [selectedId, baseUrl, savedKeys, refresh]);
  const [manualRequest, setManualRequest] = useState<{ provider: string; source: typeof modelSource } | null>(null);
  // Saving a custom URL alone must not send the stored key to that URL.
  const modelRequest = requiresBaseUrl
    ? (manualRequest?.source === modelSource ? manualRequest : null)
    : (canUseKey ? modelSource : null);
  const [modelResult, setModelResult] = useState<{
    request: NonNullable<typeof modelRequest>;
    models: string[];
    error?: string;
  } | null>(null);
  const [refreshError, setRefreshError] = useState<typeof modelSource | null>(null);
  const currentResult = modelResult?.request === modelRequest ? modelResult : null;
  const providerModels = currentResult?.models ?? [];
  const modelsError = refreshError === modelSource
    ? 'Save your changes before refreshing the model list.'
    : currentResult?.error;
  const modelsLoading = modelRequest !== null && !currentResult;
  const datalistId = `ai-models-${selectedId}`;
  const testResult = lastTest?.provider === selectedId ? lastTest.result : null;

  // Keep a saved selection visible even if the catalog failed to load or no longer lists it.
  const options = [
    { id: DISABLED_AI_PROVIDER, name: 'No provider' },
    ...(providers ?? []).map(p => ({ id: p.id ?? '', name: p.displayName ?? p.id ?? '' })),
    ...(!provider && selectedId !== DISABLED_AI_PROVIDER ? [{ id: selectedId, name: selectedId }] : [])
  ];

  useEffect(() => {
    if (!modelRequest) return;
    const controller = new AbortController();
    const loadModels = async () => {
      try {
        const result = await getAiProviderModels(modelRequest.provider, controller.signal);
        if (!controller.signal.aborted) {
          setModelResult({ request: modelRequest, models: result.models ?? [], error: result.error ?? undefined });
        }
      } catch (e: unknown) {
        if (!controller.signal.aborted) {
          const error = (e instanceof Error && e.message) || 'Failed to load models.';
          setModelResult({ request: modelRequest, models: [], error });
        }
      }
    };
    void loadModels();
    return () => controller.abort();
  }, [modelRequest]);

  const refreshModels = async () => {
    // Save an edited server URL before the server looks up the provider.
    if (!(await saveNow())) {
      setRefreshError(modelSource);
      return;
    }
    setRefreshError(null);
    if (requiresBaseUrl) {
      setManualRequest({ provider: selectedId, source: modelSource });
    } else {
      setRefreshByProvider(current => ({ ...current, [selectedId]: (current[selectedId] ?? 0) + 1 }));
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

      {provider && (
        <>
          {missing.length > 0 && (
            <Alert variant="warning" className="mb-3" style={{ fontSize: '0.9em' }} data-testid="ai-provider-incomplete">
              Add {joinWithAnd(missing)} to use {provider.displayName}.
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
              key={selectedId}
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
                placeholder={provider.defaultModel ?? 'Model ID'}
                {...configInput('model')}
              />
              <datalist id={datalistId}>
                {providerModels.map(m => <option key={m} value={m} />)}
              </datalist>
              <div className="d-flex flex-wrap align-items-center gap-2 mt-2">
                <Button variant="outline-secondary" size="sm" type="button" onClick={refreshModels} disabled={!canRefresh || modelsLoading}>
                  {modelsLoading ? 'Loading models...' : 'Refresh models'}
                </Button>
                {(currentResult || modelsError) && (
                  <span className={`small ${modelsError ? 'text-danger' : 'text-muted'}`} role="status">
                    {modelsError || (providerModels.length > 0
                      ? `${providerModels.length} ${providerModels.length === 1 ? 'model' : 'models'} available.`
                      : 'The provider listed no models.')}
                  </span>
                )}
              </div>
              <Form.Text className="text-muted d-block">
                {provider.defaultModel
                  ? <>Leave empty to use <code>{provider.defaultModel}</code>.</>
                  : 'Required.'}{' '}
                {requiresBaseUrl ? 'Use Refresh models to check the saved server URL.' : 'Models are loaded from your provider.'}
                {provider.modelsUrl && (
                  <> See the provider's{' '}
                    <a href={provider.modelsUrl} target="_blank" rel="noopener noreferrer">model documentation</a>.
                  </>
                )}
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
            <small className="text-muted d-block mb-2 fw-bold">Per-task models</small>
            <Form.Text className="text-muted d-block mb-3">
              Empty fields use the default model for {provider.displayName}.
            </Form.Text>

            {TASKS.map(task => (
              <Form.Group key={task.key} className="mb-2" controlId={`ai${task.key}Model`}>
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
    </>
  );
};

export default AiProviderSettings;
