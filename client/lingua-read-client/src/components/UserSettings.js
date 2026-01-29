import React, { useState, useEffect } from 'react';
import { Form, Button, Card, Row, Col } from 'react-bootstrap';
import { useAuthStore } from '../utils/store';
import { getUserSettings, updateUserSettings } from '../utils/api';

const UserSettings = () => {
  const { token } = useAuthStore();
  const [settings, setSettings] = useState({
    textSize: 'medium',
    theme: 'dark',
    highlighting: 'on',
    highlightKnownWords: true
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    // Fetch user settings
    const fetchSettings = async () => {
      if (!token) return;
      
      try {
        setLoading(true);
        const response = await getUserSettings();
        
        if (response) {
          setSettings(response);
          
          // Apply theme from settings
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
  }, [token]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const newValue = type === 'checkbox' ? checked : value;
    
    setSettings(prev => ({
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      setLoading(true);
      setError('');
      setMessage('');
      
      await updateUserSettings(settings);
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