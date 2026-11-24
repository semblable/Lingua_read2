import { useState } from 'react';
import { Alert, Button, Form } from 'react-bootstrap';
import { createMpvToken, revokeMpvToken } from '../../utils/api';
import type { MpvTokenResponse } from '../../utils/api/auth';
import { useAuthStore } from '../../utils/store';

export default function MpvSettings() {
  const storeLocalMode = useAuthStore(state => state.localMode);
  const [tokenData, setTokenData] = useState<MpvTokenResponse | null>(null);
  const [busyAction, setBusyAction] = useState<'generate' | 'revoke' | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const isLocalMode = tokenData?.localMode ?? storeLocalMode;
  const apiUrl = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'http://localhost:5000';

  const configText = isLocalMode
    ? `api_url=${apiUrl}\napi_token=`
    : tokenData?.token
      ? `api_url=${apiUrl}\napi_token=${tokenData.token}`
      : '';

  const handleGenerate = async () => {
    setBusyAction('generate');
    setError('');
    setStatusMessage('');
    setCopied(false);
    try {
      const response = await createMpvToken();
      setTokenData(response);
      if (response.localMode) {
        setStatusMessage('Local mode is enabled; no API token is needed.');
      } else {
        setStatusMessage('Generated a scoped mpv token. Copy the config below into script-opts.');
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to generate mpv config.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRevoke = async () => {
    setBusyAction('revoke');
    setError('');
    setStatusMessage('');
    setCopied(false);
    try {
      const response = await revokeMpvToken();
      setTokenData(null);
      setStatusMessage(
        response?.message || 'All mpv tokens and other sessions have been revoked.'
      );
    } catch (err) {
      setError((err as Error).message || 'Failed to revoke mpv tokens.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCopy = async () => {
    if (!configText) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(configText);
        setError('');
        setCopied(true);
      } else {
        setCopied(false);
        setError('Clipboard API is unavailable in this browser. Copy the config text manually.');
      }
    } catch {
      setCopied(false);
      setError('Could not copy to clipboard. Copy the config text manually.');
    }
  };

  return (
    <>
      <div className="settings-control-group">
        <p className="text-muted small mb-3">
          Watch videos in <code>mpv</code> or <code>mpv.net</code> with interactive word-colored
          subtitles, stacked reference subtitles, and instant dictionary lookups synced to your
          LinguaRead library.
        </p>

        {isLocalMode ? (
          <>
            <Alert variant="info" className="mb-3">
              <strong>Password-free local mode:</strong> No API token is required on this
              computer. Keep <code>api_token=</code> blank in <code>linguaread.conf</code>.
            </Alert>
            <Form.Group controlId="mpvConfigOutput" className="mb-2">
              <Form.Label className="fw-semibold">Ready-to-copy <code>linguaread.conf</code></Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                readOnly
                value={configText}
                className="font-monospace small"
              />
            </Form.Group>
            <div className="d-flex flex-wrap gap-2 mb-3">
              <Button type="button" variant="outline-primary" size="sm" onClick={handleCopy}>
                {copied ? 'Copied Config' : 'Copy Config'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="d-flex flex-wrap gap-2 mb-3">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleGenerate}
                disabled={busyAction !== null}
              >
                {busyAction === 'generate' ? 'Generating...' : 'Generate mpv Config'}
              </Button>
              <Button
                type="button"
                variant="outline-danger"
                size="sm"
                onClick={handleRevoke}
                disabled={busyAction !== null}
              >
                {busyAction === 'revoke' ? 'Revoking...' : 'Revoke mpv Tokens'}
              </Button>
            </div>

            <p className="text-muted small mb-3">
              Scoped <code>mpv</code> tokens can only sync subtitle sessions, look up or grade
              words, and log listening progress. Revoking invalidates all <code>mpv</code> tokens
              and signs out other browser sessions while keeping this browser signed in.
            </p>

            {configText && (
              <div className="mb-3">
                <Form.Group controlId="mpvConfigOutput" className="mb-2">
                  <Form.Label className="fw-semibold"><code>linguaread.conf</code></Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={2}
                    readOnly
                    value={configText}
                    className="font-monospace small"
                  />
                </Form.Group>
                <div className="d-flex flex-wrap align-items-center gap-2">
                  <Button type="button" variant="outline-primary" size="sm" onClick={handleCopy}>
                    {copied ? 'Copied Config' : 'Copy Config'}
                  </Button>
                  {tokenData?.expiresAt && (
                    <small className="text-muted">
                      Expires: {new Date(tokenData.expiresAt).toLocaleString()}
                    </small>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {statusMessage && <Alert variant="success" className="py-2 small">{statusMessage}</Alert>}
        {error && <Alert variant="danger" className="py-2 small">{error}</Alert>}
      </div>

      <div className="settings-control-group mb-0">
        <h6 className="fw-semibold mb-2">3-Step Player Setup</h6>
        <ol className="small text-muted ps-3 mb-0">
          <li className="mb-1">
            Copy <code>scripts/mpv/linguaread.lua</code> into your scripts folder:
            <ul className="mt-1 mb-1">
              <li><strong>Windows mpv.net:</strong> <code>%APPDATA%\mpv.net\Scripts\linguaread.lua</code></li>
              <li><strong>Standard mpv:</strong> <code>%APPDATA%\mpv\scripts\linguaread.lua</code> (Windows) or <code>~/.config/mpv/scripts/linguaread.lua</code> (Linux/macOS)</li>
            </ul>
          </li>
          <li className="mb-1">
            Save the <code>linguaread.conf</code> snippet above into <code>script-opts</code>:
            <ul className="mt-1 mb-1">
              <li><strong>Windows mpv.net:</strong> <code>%APPDATA%\mpv.net\script-opts\linguaread.conf</code></li>
              <li><strong>Standard mpv:</strong> <code>%APPDATA%\mpv\script-opts\linguaread.conf</code> (Windows) or <code>~/.config/mpv/script-opts/linguaread.conf</code> (Linux/macOS)</li>
            </ul>
          </li>
          <li>
            Open a video and press <code>Ctrl+l</code> inside the player to pick your language and subtitle track, then confirm <strong>Start &amp; Sync Episode to Library</strong>.
          </li>
        </ol>
      </div>
    </>
  );
}
