import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form } from 'react-bootstrap';
import type { Settings } from '../../contexts/SettingsContext';
import { getAiPromptDefaults } from '../../utils/api';
import type { AiPromptDefaults } from '../../utils/api/aiProviders';

const PROMPTS = [
  {
    field: 'customTranslationPrompt',
    label: 'Translation — custom prompt',
    defaultName: 'Default sentence translation prompt',
    defaultKey: 'sentenceTranslation',
    note: 'This override applies to sentences and highlighted selections. Full-text translation uses its own sentence-pair template.',
    related: [
      { name: 'Default selection translation prompt', key: 'selectionTranslation' },
      { name: 'Full-text translation prompt', key: 'fullTextTranslation' }
    ]
  },
  {
    field: 'customExplanationPrompt',
    label: 'Sentence explanation — custom prompt',
    defaultName: 'Default sentence explanation prompt',
    defaultKey: 'sentenceExplanation'
  },
  {
    field: 'customStoryPrompt',
    label: 'Story generation — custom prompt',
    defaultName: 'Default story generation prompt',
    defaultKey: 'story',
    note: 'Vocabulary practice uses its own template unless this override includes {wordList}. If you include it, keep the JSON format shown below.',
    related: [{ name: 'Default vocabulary practice prompt', key: 'vocabularyPractice' }]
  },
  {
    field: 'customSummarizationPrompt',
    label: 'Summarization — custom prompt',
    defaultName: 'Default summarization prompt',
    defaultKey: 'summarization'
  }
] as const;

type Prompt = (typeof PROMPTS)[number];

interface AiPromptSettingsProps {
  settings: Pick<Settings, Prompt['field']>;
  onChange: (field: Prompt['field'], value: string) => void;
}

interface PromptEditorProps {
  prompt: Prompt;
  value: string;
  defaults: AiPromptDefaults | null;
  onChange: (value: string) => void;
}

const PromptEditor = ({ prompt, value, defaults, onChange }: PromptEditorProps) => {
  const [draft, setDraft] = useState('');
  const editor = useRef<HTMLTextAreaElement>(null);
  const template = defaults?.[prompt.defaultKey];
  const editing = Boolean(value || draft);

  return (
    <div className="mb-3 pb-3 border-bottom">
      <Form.Group controlId={prompt.field}>
        <Form.Label>{prompt.label}</Form.Label>
        <Form.Control
          as="textarea"
          ref={editor}
          rows={3}
          name={prompt.field}
          placeholder="Using the default prompt"
          value={value || draft}
          onChange={event => {
            setDraft('');
            onChange(event.target.value);
          }}
          className="font-monospace small"
        />
        {'note' in prompt && <Form.Text>{prompt.note}</Form.Text>}
      </Form.Group>
      {editing && (
        <Button variant="outline-secondary" size="sm" type="button" className="mt-2" onClick={() => {
          setDraft('');
          if (value) onChange('');
        }}>
          {value ? 'Reset to default' : 'Discard draft'}
        </Button>
      )}
      {template && (
        <details className="mt-2">
          <summary>{prompt.defaultName}</summary>
          <pre className="ai-prompt-preview" tabIndex={0}>{template}</pre>
          {!editing && (
            <Button variant="outline-secondary" size="sm" type="button" onClick={() => {
              setDraft(template);
              editor.current?.focus();
            }}>
              Edit a copy
            </Button>
          )}
        </details>
      )}
      {'related' in prompt && prompt.related.map(({ name, key }) => {
        const text = defaults?.[key];
        return text && (
          <details className="mt-2" key={key}>
            <summary>{name}</summary>
            <pre className="ai-prompt-preview" tabIndex={0}>{text}</pre>
          </details>
        );
      })}
    </div>
  );
};

const AiPromptSettings = ({ settings, onChange }: AiPromptSettingsProps) => {
  const [defaults, setDefaults] = useState<AiPromptDefaults | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    getAiPromptDefaults(controller.signal).then(result => {
      if (!controller.signal.aborted) setDefaults(result);
    }).catch(() => {
      if (!controller.signal.aborted) setError('Default prompts could not be loaded.');
    });
    return () => controller.abort();
  }, []);

  return (
    <div className="settings-control-group">
      <small className="text-muted d-block mb-2 fw-bold">AI prompts</small>
      <Form.Text className="d-block mb-3">
        Custom prompts apply across providers. The app fills in placeholders such as <code>{'{text}'}</code> when it sends a request.
      </Form.Text>
      {error && <Alert variant="warning">{error}</Alert>}
      {PROMPTS.map(prompt => (
        <PromptEditor
          key={prompt.field}
          prompt={prompt}
          defaults={defaults}
          value={settings[prompt.field]}
          onChange={value => onChange(prompt.field, value)}
        />
      ))}
    </div>
  );
};

export default AiPromptSettings;
