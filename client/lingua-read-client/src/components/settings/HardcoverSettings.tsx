import React, { useState } from 'react';
import { Form, Button, Alert, Spinner } from 'react-bootstrap';
import type { Settings } from '../../contexts/SettingsContext';
import type { SettingsChangeHandler } from './AppearanceSettings';
import type { HardcoverStatus } from '../../utils/api/hardcover';

interface HardcoverSettingsProps {
  settings: Settings;
  handleChange: SettingsChangeHandler;
  testingHardcover: boolean;
  clearingHardcoverToken?: boolean;
  hardcoverTestResult: HardcoverStatus | null;
  syncingHardcover: boolean;
  hardcoverSyncMessage?: { type?: string; text?: string } | null;
  onTestConnection: () => void;
  onSaveToken: (token: string) => Promise<void> | void;
  onClearToken: () => void;
  onSyncAll: () => void;
}

const HardcoverSettings = ({
  settings,
  handleChange,
  testingHardcover,
  clearingHardcoverToken = false,
  hardcoverTestResult,
  syncingHardcover,
  hardcoverSyncMessage,
  onTestConnection,
  onSaveToken,
  onClearToken,
  onSyncAll
}: HardcoverSettingsProps) => {
  const [token, setToken] = useState('');
  const [savingToken, setSavingToken] = useState(false);

  const saveToken = async () => {
    if (!token.trim() || savingToken || clearingHardcoverToken || syncingHardcover) return;
    setSavingToken(true);
    try {
      await onSaveToken(token);
      setToken('');
    } catch {
      // The parent shows the error; keep the typed token so the user can retry.
    } finally {
      setSavingToken(false);
    }
  };

  // Enter would otherwise reach the settings form, which never carries the token.
  const handleTokenKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void saveToken();
    }
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
            onKeyDown={handleTokenKeyDown}
            disabled={savingToken || clearingHardcoverToken}
          />
          {token.trim() && !savingToken && (
            <Form.Text className="d-block text-warning-emphasis">Not saved yet: press Enter or Save Token</Form.Text>
          )}
          <Form.Text className="text-muted">
            Get your token from{' '}
            <a
              href="https://hardcover.app/account/api/keys/new?scope=read:me:content+read:catalog+read:library+write:library"
              target="_blank"
              rel="noopener noreferrer"
            >
              Hardcover API settings
            </a>
            . Required scopes: <code>read:me:content</code>, <code>read:catalog</code>,{' '}
            <code>read:library</code>, and <code>write:library</code>. Tokens expire based on the
            expiration you choose on Hardcover. Saved tokens are not returned to the browser.
          </Form.Text>
        </Form.Group>

        <div className="d-flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            type="button"
            onClick={saveToken}
            disabled={savingToken || clearingHardcoverToken || syncingHardcover || !token.trim()}
          >
            {savingToken ? 'Saving...' : 'Save Token'}
          </Button>
          <Button
            variant="outline-secondary"
            size="sm"
            type="button"
            onClick={onTestConnection}
            disabled={testingHardcover || savingToken || clearingHardcoverToken || syncingHardcover || !settings.hasHardcoverApiToken}
          >
            {testingHardcover ? 'Testing...' : 'Test Connection'}
          </Button>
          <Button
            variant="outline-danger"
            size="sm"
            type="button"
            onClick={onClearToken}
            disabled={clearingHardcoverToken || savingToken || syncingHardcover || !settings.hasHardcoverApiToken}
          >
            {clearingHardcoverToken ? 'Clearing...' : 'Clear Token'}
          </Button>
          <Button
            variant="outline-primary"
            size="sm"
            type="button"
            onClick={onSyncAll}
            disabled={
              syncingHardcover ||
              savingToken ||
              clearingHardcoverToken ||
              testingHardcover ||
              !settings.hasHardcoverApiToken ||
              !settings.hardcoverSyncEnabled
            }
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
          <Alert variant={hardcoverSyncMessage.type || 'info'} className="mt-3 mb-0">
            {hardcoverSyncMessage.text}
          </Alert>
        )}
      </div>
    </>
  );
};

export default HardcoverSettings;
