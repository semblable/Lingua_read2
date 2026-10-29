import React, { useState } from 'react';
import { Container, Form, Button, Alert, Card } from 'react-bootstrap';
import { useAuthStore } from '../utils/store';

const Setup = () => {
  const [password, setPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const setup = useAuthStore((s) => s.setup);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await setup(password, setupToken || undefined);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Setup failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container className="d-flex justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
      <Card style={{ width: '100%', maxWidth: '400px' }} className="p-4">
        <Card.Body>
          <h2 className="text-center mb-3">LinguaRead</h2>
          <p className="text-center text-muted mb-4">Set your password to get started. Import a small text next; provider keys are optional and can be added in Settings.</p>
          {error && <Alert variant="danger">{error}</Alert>}
          <Form onSubmit={handleSubmit}>
            <Form.Group className="mb-3" controlId="setupToken">
              <Form.Label>Operator setup token</Form.Label>
              <Form.Control type="password" autoComplete="off" value={setupToken} onChange={(e) => setSetupToken(e.target.value)} />
              <Form.Text className="text-muted">Required outside Development. Ask the server operator for the LINGUAREAD_SETUP_TOKEN, or sign in if an initial password was configured.</Form.Text>
            </Form.Group>
            <Form.Group className="mb-3" controlId="password">
              <Form.Label>Password</Form.Label>
              <Form.Control
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Choose a password"
                required
                autoFocus
                size="lg"
              />
            </Form.Group>
            <Form.Group className="mb-3" controlId="confirm">
              <Form.Label>Confirm Password</Form.Label>
              <Form.Control
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Confirm your password"
                required
                size="lg"
              />
            </Form.Group>
            <Button
              variant="primary"
              type="submit"
              className="w-100"
              size="lg"
              disabled={loading}
            >
              {loading ? 'Setting up...' : 'Set Password'}
            </Button>
          </Form>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default Setup;
