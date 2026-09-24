import { Button, Spinner } from 'react-bootstrap';
import type { AutoSaveStatus } from '../../hooks/useAutoSave';

interface SaveStatusProps {
  status: AutoSaveStatus;
  error: string | null;
  onRetry: () => void;
}

/**
 * Sticky pill at the bottom of the settings page, where it stays in view however far the page is
 * scrolled. Hidden while there is nothing to report.
 */
const SaveStatus = ({ status, error, onRetry }: SaveStatusProps) => {
  const isError = status === 'error';
  return (
    <div className="settings-save-status-dock">
      <div
        className={[
          'settings-save-status',
          status === 'idle' ? 'settings-save-status--hidden' : '',
          isError ? 'settings-save-status--error' : ''
        ].filter(Boolean).join(' ')}
        role={isError ? 'alert' : 'status'}
        aria-live={isError ? 'assertive' : 'polite'}
        data-status={status}
      >
        {(status === 'pending' || status === 'saving') && (
          <>
            <Spinner animation="border" size="sm" aria-hidden="true" />
            <span>Saving…</span>
          </>
        )}
        {status === 'saved' && (
          <>
            <i className="bi bi-check-circle-fill" aria-hidden="true" />
            <span>All changes saved</span>
          </>
        )}
        {isError && (
          <>
            <i className="bi bi-exclamation-triangle-fill" aria-hidden="true" />
            <span>Couldn't save your changes{error ? `: ${error}` : '.'}</span>
            <Button variant="outline-danger" size="sm" type="button" onClick={onRetry}>
              Retry
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default SaveStatus;
