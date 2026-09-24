import React, { useEffect, useState } from 'react';
import { Form, Button } from 'react-bootstrap';

interface SecretKeyFieldProps {
  controlId: string;
  label: string;
  /** API field name on UpdateUserSettingsDto, e.g. 'azureTranslatorKey'. */
  field: string;
  /** Whether a value is already stored server-side (drives the "configured" placeholder). */
  hasValue: boolean;
  /** Rejecting shows the error under the field and keeps the typed value. */
  onSave: (field: string, value: string) => Promise<void> | void;
  onClear: (field: string) => Promise<void> | void;
  /** Placeholder shown when no value is stored yet. */
  placeholder?: string;
  helpText?: React.ReactNode;
  /** Spacing class for the wrapping Form.Group (defaults to mb-3). */
  className?: string;
}

/**
 * Write-only secret input. The stored secret is never returned to the browser; the parent only
 * knows whether one is configured (`hasValue`). Typing a new value and clicking Save (or pressing
 * Enter) sends just that field; Clear sends an empty string (the API treats empty as "remove").
 * Unlike the rest of the settings page it doesn't save by itself, so a half-pasted key is never
 * stored. Mirrors the Hardcover token controls.
 */
const SecretKeyField = ({
  controlId,
  label,
  field,
  hasValue,
  onSave,
  onClear,
  placeholder,
  helpText,
  className = 'mb-3'
}: SecretKeyFieldProps) => {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  const save = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSave(field, value.trim());
      setValue('');
      setNotice('Saved');
    } catch (e: unknown) {
      // Keep the typed value so the user can retry.
      setError((e instanceof Error && e.message) || 'Failed to save.');
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError('');
    try {
      await onClear(field);
      setValue('');
      setNotice('Cleared');
    } catch (e: unknown) {
      setError((e instanceof Error && e.message) || 'Failed to clear.');
    } finally {
      setBusy(false);
    }
  };

  // Enter would otherwise reach the settings form, which never carries a secret.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void save();
    }
  };

  const unsaved = value.trim() !== '';

  return (
    <Form.Group className={className} controlId={controlId}>
      <Form.Label>{label}</Form.Label>
      <Form.Control
        type="password"
        autoComplete="off"
        placeholder={hasValue ? 'Configured — leave blank to keep' : (placeholder ?? '')}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setError('');
        }}
        onKeyDown={handleKeyDown}
        isInvalid={!!error}
      />
      <div className="d-flex flex-wrap gap-2 mt-2">
        <Button variant="primary" size="sm" type="button" onClick={save} disabled={busy || !unsaved}>
          Save
        </Button>
        <Button variant="outline-danger" size="sm" type="button" onClick={clear} disabled={busy || !hasValue}>
          Clear
        </Button>
        {unsaved && !busy && (
          <span className="text-warning-emphasis small align-self-center">Not saved yet: press Enter or Save</span>
        )}
        {!unsaved && notice && <span className="text-success small align-self-center">{notice}</span>}
        {!unsaved && !notice && hasValue && <span className="text-muted small align-self-center">Configured</span>}
      </div>
      {error && <div className="text-danger small mt-1" role="alert">{error}</div>}
      {helpText && <Form.Text className="text-muted d-block">{helpText}</Form.Text>}
    </Form.Group>
  );
};

export default SecretKeyField;
