import React, { useState } from 'react';
import { Container, Form, Button, Alert, Card } from 'react-bootstrap';
import { useAuthStore } from '../utils/store';
import { LoginError } from '../utils/api/auth';

const Login = () => {
  const [password, setPassword] = useState('');
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [recoveryToken, setRecoveryToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const logoutWarning = useAuthStore((s) => s.logoutWarning);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const token = recoveryToken.trim();
      await (token ? login(password, token) : login(password));
      setRecoveryAvailable(false);
      setRecoveryToken('');
    } catch (err: unknown) {
      if (err instanceof LoginError && err.recoveryAvailable !== undefined) {
        setRecoveryAvailable(err.recoveryAvailable);
        if (!err.recoveryAvailable) setRecoveryToken('');
      }
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container className="d-flex justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
      <Card style={{ width: '100%', maxWidth: '400px' }} className="p-4">
        <Card.Body>
          <h2 className="text-center mb-4">LinguaRead</h2>
          {error && <Alert variant="danger">{error}</Alert>}
          {logoutWarning && <Alert variant="warning">{logoutWarning}</Alert>}
          <Form onSubmit={handleSubmit}>
            <Form.Group className="mb-3" controlId="password">
              <Form.Label>Password</Form.Label>
              <Form.Control
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                autoFocus
                size="lg"
              />
            </Form.Group>
            {recoveryAvailable && <Form.Group className="mb-3" controlId="recovery-token">
              <Form.Label>Owner recovery code (optional)</Form.Label>
              <Form.Control type="password" autoComplete="off" value={recoveryToken}
                onChange={event => setRecoveryToken(event.target.value)} />
            </Form.Group>}
            <Button
              variant="primary"
              type="submit"
              className="w-100"
              size="lg"
              disabled={loading}
            >
              {loading ? 'Logging in...' : 'Log In'}
            </Button>
          </Form>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default Login;
