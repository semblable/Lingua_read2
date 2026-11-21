import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Form, Modal } from 'react-bootstrap';
import { authLogin, ensureLoginSucceeded, LoginError } from '../../utils/api/auth';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { WORD_STATUS_LABELS, type WordStatus } from '../../types/wordStatus';
import { drain, pending, listWordConflicts, resolveWordConflict, type SyncHandlers, type WordConflict } from '../../utils/offline/syncQueue';
import { notifyOfflineEvent, offlineSessionRevision, subscribeOfflineEvent } from '../../utils/offline/events';

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
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [recoveryToken, setRecoveryToken] = useState('');
  const [loginError, setLoginError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [wordConflicts, setWordConflicts] = useState<WordConflict[]>([]);
  const [showWordConflicts, setShowWordConflicts] = useState(false);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const [conflictError, setConflictError] = useState('');
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
      setRecoveryAvailable(false);
      setRecoveryToken('');
      setShowLogin(false);
    });
    const stopSession = subscribeOfflineEvent('session-ended', () => {
      setWordConflicts([]);
      setShowWordConflicts(false);
    });
    return () => { stopRequired(); stopRestored(); stopSession(); };
  }, []);
  useEffect(() => () => { if (retryTimer.current) clearTimeout(retryTimer.current); }, []);

  const refreshCount = useCallback(async () => {
    try {
      const session = offlineSessionRevision();
      const [count, conflicts] = await Promise.all([pending(), listWordConflicts()]);
      if (session !== offlineSessionRevision()) return;
      setPendingCount(count);
      setWordConflicts(conflicts);
      if (conflicts.length === 0) setShowWordConflicts(false);
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
        if (result.attempted > 0 && await pending() === 0) notifyOfflineEvent('sync-complete');
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
      const token = recoveryToken.trim();
      const response = await (token ? authLogin(password, token) : authLogin(password));
      await ensureLoginSucceeded(response, 'Sign in failed.');
      setPassword('');
      notifyOfflineEvent('auth-restored');
      setAuthRequired(false);
      setShowLogin(false);
      nextAttemptAt.current = 0;
      await handleDrainNow();
    } catch (error) {
      if (error instanceof LoginError && error.recoveryAvailable !== undefined) {
        setRecoveryAvailable(error.recoveryAvailable);
        if (!error.recoveryAvailable) setRecoveryToken('');
      }
      setLoginError(error instanceof Error ? error.message : 'Sign in failed.');
    } finally { setSigningIn(false); }
  };

  // Periodically re-read the queue count so mutations enqueued from other
  // call sites surface here too.
  useEffect(() => {
    refreshCount();
    const stopRefresh = subscribeOfflineEvent('sync-complete', refreshCount);
    const id = window.setInterval(refreshCount, pollIntervalMs);
    return () => { stopRefresh(); window.clearInterval(id); };
  }, [refreshCount, pollIntervalMs]);

  const decideWordConflict = async (id: number, reapply: boolean) => {
    setResolvingConflict(true);
    setConflictError('');
    try {
      await resolveWordConflict(id, reapply);
      if (reapply) {
        nextAttemptAt.current = 0;
        await handleDrainNow();
      } else {
        await refreshCount();
        notifyOfflineEvent('sync-complete');
      }
    } catch {
      setConflictError('Could not resolve the offline edit. Try again.');
    } finally {
      setResolvingConflict(false);
    }
  };

  const showSync = !online || pendingCount > 0 || authRequired;
  if (!showSync && wordConflicts.length === 0) return null;

  const label = !online
    ? `Offline${pendingCount > 0 ? ` · ${pendingCount} queued` : ''}`
    : `${pendingCount} change${pendingCount === 1 ? '' : 's'} pending sync`;

  return (
    <>
    {wordConflicts.length > 0 && (
      <Button variant="outline-secondary" size="sm" className="ms-2" onClick={() => setShowWordConflicts(true)}>
        Review offline edits ({wordConflicts.length})
      </Button>
    )}
    {showSync && <button
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
    </button>}
    <Modal show={showWordConflicts} onHide={() => setShowWordConflicts(false)}>
      <Modal.Header closeButton><Modal.Title>Review offline vocabulary edits</Modal.Title></Modal.Header>
      <Modal.Body>
        <p>These edits are saved on this device. Each word has a newer saved version.</p>
        {conflictError && <Alert variant="danger">{conflictError}</Alert>}
        {wordConflicts.map(({ id, conflictingWord, payload }) => (
          <section key={id} className="border-top py-2 text-break">
            <h3 className="h6">{conflictingWord.term}</h3>
            <p className="mb-2">
              Saved version at sync · {WORD_STATUS_LABELS[conflictingWord.status as WordStatus]}.
              {conflictingWord.translation && ` ${conflictingWord.translation}`}
            </p>
            <p className="mb-2">
              Offline edit · {payload.translationOnly ? 'Translation' : WORD_STATUS_LABELS[payload.status as WordStatus]}.
              {payload.translation !== undefined && (payload.translation ? ` ${payload.translation}` : ' Translation cleared.')}
            </p>
            <div className="d-flex flex-wrap gap-2">
              <Button size="sm" variant="outline-secondary" disabled={resolvingConflict}
                onClick={() => { void decideWordConflict(id, false); }}>Keep saved version</Button>
              <Button size="sm" disabled={resolvingConflict || draining || !online || authRequired}
                onClick={() => { void decideWordConflict(id, true); }}>Apply offline edit</Button>
            </div>
          </section>
        ))}
      </Modal.Body>
    </Modal>
    <Modal show={showLogin} onHide={() => { setRecoveryToken(''); setShowLogin(false); }}>
      <Modal.Header closeButton><Modal.Title>Sign in to sync</Modal.Title></Modal.Header>
      <Form onSubmit={signIn}>
        <Modal.Body>
          <p>Your session expired. You can keep reading; sign in to resume syncing.</p>
          {loginError && <Alert variant="danger">{loginError}</Alert>}
          <Form.Group controlId="sync-password"><Form.Label>Password</Form.Label>
            <Form.Control type="password" autoComplete="current-password" required value={password}
              onChange={event => setPassword(event.target.value)} />
          </Form.Group>
          {recoveryAvailable && <Form.Group className="mt-3" controlId="sync-recovery-token">
            <Form.Label>Owner recovery code (optional)</Form.Label>
            <Form.Control type="password" autoComplete="off" value={recoveryToken}
              onChange={event => setRecoveryToken(event.target.value)} />
          </Form.Group>}
        </Modal.Body>
        <Modal.Footer><Button type="submit" disabled={signingIn}>{signingIn ? 'Signing in…' : 'Sign in'}</Button></Modal.Footer>
      </Form>
    </Modal>
    </>
  );
};

export default OfflineIndicator;
