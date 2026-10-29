import { useState } from 'react';
import { Alert, Button, Form } from 'react-bootstrap';
import { fetchApi } from '../../utils/api/client';

export default function PasswordSettings() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  return <Form className="settings-control-group" onSubmit={async (event) => {
    event.preventDefault();
    setBusy(true); setMessage(''); setError('');
    try {
      await fetchApi('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
      setCurrentPassword(''); setNewPassword('');
      setMessage('Password changed. Other sessions have been signed out.');
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }}>
    <h6>Change password</h6>
    <p className="text-muted small">Changing your password signs out other sessions. Logout signs out all devices. If you forget your password, ask the server operator to follow the recovery guide.</p>
    <Form.Group controlId="currentPassword" className="mb-2">
      <Form.Label>Current password</Form.Label>
      <Form.Control type="password" autoComplete="current-password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
    </Form.Group>
    <Form.Group controlId="newPassword" className="mb-2">
      <Form.Label>New password</Form.Label>
      <Form.Control type="password" autoComplete="new-password" minLength={6} required value={newPassword} onChange={e => setNewPassword(e.target.value)} />
    </Form.Group>
    {message && <Alert variant="success">{message}</Alert>}
    {error && <Alert variant="danger">{error}</Alert>}
    <Button type="submit" disabled={busy}>{busy ? 'Changing password...' : 'Change password'}</Button>
  </Form>;
}
