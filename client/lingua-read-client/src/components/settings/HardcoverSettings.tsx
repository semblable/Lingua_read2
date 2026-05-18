import React, { useState } from 'react';
import { Form, Button, Alert, Spinner } from 'react-bootstrap';
import type { Settings } from '../../contexts/SettingsContext';
import type { SettingsChangeHandler } from './AppearanceSettings';
import type { ResponseOf } from '../../utils/fetchApi';

type HardcoverTestResult = ResponseOf<'/api/Hardcover/status', 'get'>;

interface HardcoverSettingsProps {
  settings: Settings;
  handleChange: SettingsChangeHandler;
  testingHardcover: boolean;
  hardcoverTestResult: HardcoverTestResult | null;
  syncingHardcover: boolean;
  hardcoverSyncMessage: { type?: string; text?: string };
  onTestConnection: () => void;
  onSaveToken: (token: string) => Promise<void> | void;
  onClearToken: () => void;
  onSyncAll: () => void;
}

const HardcoverSettings = ({
  settings,
  handleChange,
  testingHardcover,
  hardcoverTestResult,
  syncingHardcover,
  hardcoverSyncMessage,
  onTestConnection,
  onSaveToken,
  onClearToken,
  onSyncAll
}: HardcoverSettingsProps) => {
  const [token, setToken] = useState('');

  const saveToken = async () => {
    await onSaveToken(token);
    setToken('');
  };

  return (
    <>
      <div className="settings-control-group">
        <Form.Group className="mb-3" controlId="hardcoverSyncEnabled">
          <Form.Check
            type="switch"
            name="hardcoverSyncEnabled"
            label="Enable automatic Hardcover progress sync"
            checked={settings.hardcoverSyncEnabled}
            onChange={handleChange}
          />
          <Form.Text className="text-muted">
            When enabled, completing book parts in Lingua Read will update the linked Hardcover book.
          </Form.Text>
        </Form.Group>

        <Form.Group className="mb-3" controlId="hardcoverApiToken">
          <Form.Label>Hardcover API Token</Form.Label>
          <Form.Control
            type="password"
            autoComplete="off"
            placeholder={settings.hasHardcoverApiToken ? 'Token configured' : 'Paste your Hardcover API token'}
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <Form.Text className="text-muted">
            Get your token from <a href="https://hardcover.app/account/api" target="_blank" rel="noopener noreferrer">Hardcover API settings</a>.
            Saved tokens are not returned to the browser.
          </Form.Text>
        </Form.Group>

        <div className="d-flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            type="button"
            onClick={saveToken}
            disabled={!token.trim()}
          >
            Save Token
          </Button>
          <Button
            variant="outline-secondary"
            size="sm"
            type="button"
            onClick={onTestConnection}
            disabled={testingHardcover || !settings.hasHardcoverApiToken}
          >
            {testingHardcover ? 'Testing...' : 'Test Connection'}
          </Button>
          <Button
            variant="outline-danger"
            size="sm"
            type="button"
            onClick={onClearToken}
            disabled={!settings.hasHardcoverApiToken}
          >
            Clear Token
          </Button>
          <Button
            variant="outline-primary"
            size="sm"
            type="button"
            onClick={onSyncAll}
            disabled={syncingHardcover || !settings.hasHardcoverApiToken || !settings.hardcoverSyncEnabled}
          >
            {syncingHardcover ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Syncing...
              </>
            ) : 'Sync All Books'}
          </Button>
        </div>

        {settings.hasHardcoverApiToken && (
          <div className="text-muted small mt-2">
            Token configured{settings.hardcoverLastSyncAt ? ` | Last sync: ${new Date(settings.hardcoverLastSyncAt).toLocaleString()}` : ''}
          </div>
        )}

        {hardcoverTestResult && (
          <Alert
            variant={hardcoverTestResult.connected ? 'success' : 'danger'}
            className="mt-3 mb-0"
            style={{ fontSize: '0.9em' }}
          >
            {hardcoverTestResult.message}
            {hardcoverTestResult.username && (
              <div className="mt-1">Connected as {hardcoverTestResult.username}</div>
            )}
          </Alert>
        )}

        {hardcoverSyncMessage?.text && (
          <Alert variant={hardcoverSyncMessage.type} className="mt-3 mb-0">
            {hardcoverSyncMessage.text}
          </Alert>
        )}
      </div>
    </>
  );
};

export default HardcoverSettings;
