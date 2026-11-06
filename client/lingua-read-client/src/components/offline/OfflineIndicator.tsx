import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Form, Modal } from 'react-bootstrap';
import { authLogin } from '../../utils/api/auth';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { drain, pending, type SyncHandlers } from '../../utils/offline/syncQueue';
import { notifyOfflineEvent, subscribeOfflineEvent } from '../../utils/offline/events';

interface OfflineIndicatorProps {
  /**
   * Replay handlers for the three queued op types. The component itself does
   * not import the API helpers so it can be unit-tested without mocking
   * fetch — App.tsx wires the real handlers at mount time.
   */
  handlers: SyncHandlers;
  /** Polling interval for the pending count when online. Defaults to 5s. */
  pollIntervalMs?: number;
}

const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({
  handlers,
  pollIntervalMs = 5000,
}) => {
  const [pendingCount, setPendingCount] = useState(0);
  const [draining, setDraining] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(1000);
  const nextAttemptAt = useRef(0);
  const authRequiredRef = useRef(false);
  useEffect(() => {
    const stopRequired = subscribeOfflineEvent('auth-required', () => {
      if (authRequiredRef.current) return;
      authRequiredRef.current = true;
      setAuthRequired(true);
      setShowLogin(true);
    });
    const stopRestored = subscribeOfflineEvent('auth-restored', () => {
      authRequiredRef.current = false;
      setAuthRequired(false);
      setShowLogin(false);
    });
    return () => { stopRequired(); stopRestored(); };
  }, []);
  useEffect(() => () => { if (retryTimer.current) clearTimeout(retryTimer.current); }, []);

  const refreshCount = useCallback(async () => {
    try {
      setPendingCount(await pending());
    } catch {
      // No-op: count is best-effort UI.
    }
  }, []);

  const handleDrainNow = useCallback(async () => {
    if (draining || Date.now() < nextAttemptAt.current) return;
    setDraining(true);
    try {
      const result = await drain(handlers);
      if (result.authRequired) {
        authRequiredRef.current = true;
        setAuthRequired(true);
        setShowLogin(true);
      } else if (result.failed > 0 && await pending() > 0) {
        nextAttemptAt.current = Date.now() + retryDelay.current;
        retryDelay.current = Math.min(60000, retryDelay.current * 2);
      } else {
        retryDelay.current = 1000;
        nextAttemptAt.current = 0;
        if (result.succeeded > 0 && await pending() === 0) notifyOfflineEvent('sync-complete');
      }
    } catch {
      // Storage can be temporarily unavailable during browser lifecycle changes.
      nextAttemptAt.current = Date.now() + retryDelay.current;
      retryDelay.current = Math.min(60000, retryDelay.current * 2);
    } finally {
      setDraining(false);
      await refreshCount();
      setRetryAt(nextAttemptAt.current || Date.now() + 1000);
    }
  }, [handlers, draining, refreshCount]);

  const online = useOnlineStatus({ onReconnect: handleDrainNow });

  useEffect(() => {
    if (!online || authRequired || pendingCount === 0 || draining) return;
    const delay = Math.max(1000, retryAt - Date.now());
    retryTimer.current = setTimeout(() => { void handleDrainNow(); }, delay);
    return () => { if (retryTimer.current) clearTimeout(retryTimer.current); };
  }, [online, authRequired, pendingCount, draining, handleDrainNow, retryAt]);

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setSigningIn(true);
    setLoginError('');
    try {
      const response = await authLogin(password);
      if (!response.ok) throw new Error((await response.json()).message || 'Sign in failed.');
      setPassword('');
      notifyOfflineEvent('auth-restored');
      setAuthRequired(false);
      setShowLogin(false);
      nextAttemptAt.current = 0;
      await handleDrainNow();
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Sign in failed.');
    } finally { setSigningIn(false); }
  };

  // Periodically re-read the queue count so mutations enqueued from other
  // call sites surface here too.
  useEffect(() => {
    refreshCount();
    const id = window.setInterval(refreshCount, pollIntervalMs);
    return () => window.clearInterval(id);
  }, [refreshCount, pollIntervalMs]);

  if (online && pendingCount === 0 && !authRequired) return null;

  const label = !online
    ? `Offline${pendingCount > 0 ? ` · ${pendingCount} queued` : ''}`
    : `${pendingCount} change${pendingCount === 1 ? '' : 's'} pending sync`;

  return (
    <>
    <button
      type="button"
      onClick={() => authRequired ? setShowLogin(true) : void handleDrainNow()}
      disabled={draining || !online}
      data-testid="offline-indicator"
      data-online={online ? 'true' : 'false'}
      data-pending-count={pendingCount}
      className="btn btn-link p-0 ms-2 align-baseline"
      style={{ textDecoration: 'none' }}
      title={!online
        ? 'You are offline. Mutations will sync once you reconnect.'
        : 'Click to retry syncing now.'}
    >
      <Badge bg={!online ? 'warning' : 'info'} pill>
        {authRequired ? 'Sign in to sync' : label}
      </Badge>
    </button>
    <Modal show={showLogin} onHide={() => setShowLogin(false)}>
      <Modal.Header closeButton><Modal.Title>Sign in to sync</Modal.Title></Modal.Header>
      <Form onSubmit={signIn}>
        <Modal.Body>
          <p>Your session expired. You can keep reading; sign in to resume syncing.</p>
          {loginError && <Alert variant="danger">{loginError}</Alert>}
          <Form.Group controlId="sync-password"><Form.Label>Password</Form.Label>
            <Form.Control type="password" autoComplete="current-password" required value={password}
              onChange={event => setPassword(event.target.value)} />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer><Button type="submit" disabled={signingIn}>{signingIn ? 'Signing in…' : 'Sign in'}</Button></Modal.Footer>
      </Form>
    </Modal>
    </>
  );
};

export default OfflineIndicator;
