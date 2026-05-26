import React from 'react';
import { Button, Toast, ToastContainer } from 'react-bootstrap';

interface AppUpdatePromptProps {
  /** Activate the waiting service worker and reload the page. */
  onReload: () => void;
  /** Dismiss the prompt for this session without reloading. Optional —
   *  omit to hide the close button. */
  onDismiss?: () => void;
}

/**
 * Bottom-right toast that appears when vite-plugin-pwa has downloaded a new
 * bundle and is waiting for the user's permission to activate it.
 *
 * Without this prompt the service worker would sit in "waiting" state forever
 * (we ship with `registerType: 'prompt'` in `vite.config.ts`), and users would
 * keep running the cached old build indefinitely — which is exactly the bug
 * this component exists to fix.
 */
const AppUpdatePrompt: React.FC<AppUpdatePromptProps> = ({ onReload, onDismiss }) => {
  return (
    <ToastContainer
      position="bottom-end"
      className="p-3 position-fixed"
      style={{ zIndex: 1090 }}
    >
      <Toast
        show
        onClose={onDismiss}
        data-testid="app-update-prompt"
        role="status"
        aria-live="polite"
      >
        <Toast.Header closeButton={!!onDismiss}>
          <strong className="me-auto">Update available</strong>
        </Toast.Header>
        <Toast.Body>
          <div className="mb-2">A newer version of LinguaRead is ready.</div>
          <Button
            variant="primary"
            size="sm"
            onClick={onReload}
            data-testid="app-update-reload"
          >
            Reload to update
          </Button>
        </Toast.Body>
      </Toast>
    </ToastContainer>
  );
};

export default AppUpdatePrompt;
