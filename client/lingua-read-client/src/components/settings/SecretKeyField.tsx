import React, { useState } from 'react';
import { Form, Button } from 'react-bootstrap';

interface SecretKeyFieldProps {
  controlId: string;
  label: string;
  /** API field name on UpdateUserSettingsDto, e.g. 'azureTranslatorKey'. */
  field: string;
  /** Whether a value is already stored server-side (drives the "configured" placeholder). */
  hasValue: boolean;
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
 * knows whether one is configured (`hasValue`). Typing a new value and clicking Save sends just
 * that field; Clear sends an empty string (the API treats empty as "remove"). Mirrors the
 * Hardcover token controls.
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

  const save = async () => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await onSave(field, value.trim());
      setValue('');
    } catch {
      // Parent surfaces the error; keep the typed value so the user can retry.
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await onClear(field);
      setValue('');
    } catch {
      // Parent surfaces the error.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Form.Group className={className} controlId={controlId}>
      <Form.Label>{label}</Form.Label>
      <Form.Control
        type="password"
        autoComplete="off"
        placeholder={hasValue ? 'Configured — leave blank to keep' : (placeholder ?? '')}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className="d-flex flex-wrap gap-2 mt-2">
        <Button variant="primary" size="sm" type="button" onClick={save} disabled={busy || !value.trim()}>
          Save
        </Button>
        <Button variant="outline-danger" size="sm" type="button" onClick={clear} disabled={busy || !hasValue}>
          Clear
        </Button>
        {hasValue && <span className="text-muted small align-self-center">Configured</span>}
      </div>
      {helpText && <Form.Text className="text-muted d-block">{helpText}</Form.Text>}
    </Form.Group>
  );
};

export default SecretKeyField;
