import React, { useState, useEffect } from 'react';
import { Form, Button, Card, Row, Col } from 'react-bootstrap';
import { getUserSettings, updateUserSettings } from '../utils/api';

// NOTE(phase-d): This appears to be a legacy/dead component — pages/UserSettings
// is the live settings page. State shape mixes string text-size (local) with
// the full backend Settings object. Until it's removed or merged into the
// canonical settings page, keep the local state permissive.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LocalSettings = { [key: string]: any };

const UserSettings = () => {
  const [settings, setSettings] = useState<LocalSettings>({
    textSize: 'medium',
    theme: 'dark',
    textFont: 'default',
    highlighting: 'on',
    highlightKnownWords: true
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        setLoading(true);
        const response = (await getUserSettings()) as LocalSettings | null;

        if (response) {
          setSettings(response);

          if (response.theme === 'dark') {
            document.body.classList.add('dark-theme');
          } else {
            document.body.classList.remove('dark-theme');
          }
        }
      } catch (err) {
        console.error('Error fetching settings:', err);
        setError('Failed to load settings');
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const target = e.target as HTMLInputElement;
    const { name, value, type, checked } = target;
    const newValue = type === 'checkbox' ? checked : value;

    setSettings((prev) => ({
      ...prev,
      [name]: newValue
    }));

    // Apply theme change immediately
    if (name === 'theme') {
      if (value === 'dark') {
        document.body.classList.add('dark-theme');
        localStorage.setItem('theme', 'dark');
      } else {
        document.body.classList.remove('dark-theme');
        localStorage.setItem('theme', 'light');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setLoading(true);
      setError('');
      setMessage('');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await updateUserSettings(settings as any);
      setMessage('Settings saved successfully');
    } catch (err) {
      console.error('Error saving settings:', err);
      setError('Failed to save settings');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="mb-4">
      <Card.Header as="h5">User Settings</Card.Header>
      <Card.Body>
        {error && <div className="alert alert-danger">{error}</div>}
        {message && <div className="alert alert-success">{message}</div>}

        <Form onSubmit={handleSubmit}>
          <Row>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>Theme</Form.Label>
                <Form.Select
                  name="theme"
                  value={settings.theme}
                  onChange={handleChange}
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </Form.Select>
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>Text Size</Form.Label>
                <Form.Select
                  name="textSize"
                  value={settings.textSize}
                  onChange={handleChange}
                >
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>

          <Row>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>Text Font</Form.Label>
                <Form.Select
                  name="textFont"
                  value={settings.textFont}
                  onChange={handleChange}
                >
                  <option value="default">Inter (Default)</option>
                  <option value="serif">Lora (Serif)</option>
                  <option value="open-sans">Open Sans</option>
                  <option value="lato">Lato</option>
                  <option value="atkinson">Atkinson Hyperlegible</option>
                  <option value="merriweather">Merriweather</option>
                  <option value="roboto-slab">Roboto Slab</option>
                  <option value="monospace">Monospace</option>
                  <option value="comic-sans">Comic Sans</option>
                  <option value="dyslexic">OpenDyslexic</option>
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>

          <Row>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>Highlighting</Form.Label>
                <Form.Select
                  name="highlighting"
                  value={settings.highlighting}
                  onChange={handleChange}
                >
                  <option value="on">Enabled</option>
                  <option value="off">Disabled</option>
                </Form.Select>
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group className="mb-3" controlId="highlightKnownWords">
                <Form.Check
                  type="checkbox"
                  label="Highlight known words"
                  name="highlightKnownWords"
                  checked={settings.highlightKnownWords}
                  onChange={handleChange}
                />
              </Form.Group>
            </Col>
          </Row>

          <Button
            variant="primary"
            type="submit"
            disabled={loading}
          >
            {loading ? 'Saving...' : 'Save Settings'}
          </Button>
        </Form>
      </Card.Body>
    </Card>
  );
};

export default UserSettings; 