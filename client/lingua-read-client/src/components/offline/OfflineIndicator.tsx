import React, { useCallback, useEffect, useState } from 'react';
import { Badge } from 'react-bootstrap';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { drain, pending, type SyncHandlers } from '../../utils/offline/syncQueue';

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

  const refreshCount = useCallback(async () => {
    try {
      setPendingCount(await pending());
    } catch {
      // No-op: count is best-effort UI.
    }
  }, []);

  const handleDrainNow = useCallback(async () => {
    if (draining) return;
    setDraining(true);
    try {
      await drain(handlers);
    } finally {
      setDraining(false);
      await refreshCount();
    }
  }, [handlers, draining, refreshCount]);

  const online = useOnlineStatus({ onReconnect: handleDrainNow });

  // Periodically re-read the queue count so mutations enqueued from other
  // call sites surface here too.
  useEffect(() => {
    refreshCount();
    const id = window.setInterval(refreshCount, pollIntervalMs);
    return () => window.clearInterval(id);
  }, [refreshCount, pollIntervalMs]);

  if (online && pendingCount === 0) return null;

  const label = !online
    ? `Offline${pendingCount > 0 ? ` · ${pendingCount} queued` : ''}`
    : `${pendingCount} change${pendingCount === 1 ? '' : 's'} pending sync`;

  return (
    <button
      type="button"
      onClick={handleDrainNow}
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
        {label}
      </Badge>
    </button>
  );
};

export default OfflineIndicator;
