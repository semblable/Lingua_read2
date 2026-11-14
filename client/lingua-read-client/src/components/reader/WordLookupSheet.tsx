import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button, Modal } from 'react-bootstrap';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { containModalTabKey } from '../../utils/keyboard';

/** The narrow lookup uses the same native modal lifecycle as other app dialogs. */
export default function WordLookupSheet({ show, onClose, onRestoreFocus, children }: {
  show: boolean;
  onClose: () => void;
  onRestoreFocus: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const restorePending = useRef(false);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    if (!show) return;
    restorePending.current = true;
    const background = document.getElementById('root');
    if (!background) return;
    const wasInert = background.inert;
    background.inert = true;
    return () => { background.inert = wasInert; };
  }, [show]);
  return (
    <Modal show={show} onHide={onClose} onExited={() => {
      // NoopTransition also calls onExited on the initial closed mount.
      if (!restorePending.current) return;
      restorePending.current = false;
      onRestoreFocus();
    }} restoreFocus={false}
      animation={!reducedMotion} aria-labelledby={titleId} dialogClassName="word-info-sheet-dialog"
      contentClassName="word-info-sheet" scrollable onKeyDown={containModalTabKey}>
      <Modal.Header closeButton closeLabel="Close word information">
        <Modal.Title id={titleId} as="h2" className="h5">Word information</Modal.Title>
      </Modal.Header>
      <Modal.Body className="word-info-sheet-content">{children}</Modal.Body>
      <Modal.Footer><Button variant="secondary" onClick={onClose}>Close word information</Button></Modal.Footer>
    </Modal>
  );
}
