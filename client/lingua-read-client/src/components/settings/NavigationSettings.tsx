import React from 'react';
import { Form } from 'react-bootstrap';
import type { Settings } from '../../contexts/SettingsContext';
import type { SettingsChangeHandler } from './AppearanceSettings';

interface NavigationSettingsProps {
  settings: Settings;
  handleChange: SettingsChangeHandler;
}

const NavigationSettings = ({ settings, handleChange }: NavigationSettingsProps) => {
  return (
    <div className="settings-control-group">
      <Form.Group className="mb-3" controlId="minimalHome">
        <Form.Check
          type="switch"
          name="minimalHome"
          label="Use minimal home page (fast-loading, recent texts only)"
          checked={settings.minimalHome || false}
          onChange={handleChange}
        />
        <Form.Text className="text-muted" style={{ fontSize: '0.8rem' }}>
          Replaces the full home page with a lightweight version that only shows your recent texts.
        </Form.Text>
      </Form.Group>

      <Form.Group className="mb-3" controlId="autoAdvanceToNextLesson">
        <Form.Check
          type="switch"
          name="autoAdvanceToNextLesson"
          label="Automatically advance to next lesson after completion"
          checked={settings.autoAdvanceToNextLesson}
          onChange={handleChange}
        />
      </Form.Group>

      <Form.Group className="mb-3" controlId="autoMoveFinishedLessons">
        <Form.Check
          type="switch"
          name="autoMoveFinishedLessons"
          label="Automatically move finished lessons to 'Finished' folder"
          checked={settings.autoMoveFinishedLessons || false}
          onChange={handleChange}
        />
      </Form.Group>

      <Form.Group className="mb-0" controlId="showProgressStats">
        <Form.Check
          type="switch"
          name="showProgressStats"
          label="Show progress statistics after completing a lesson"
          checked={settings.showProgressStats}
          onChange={handleChange}
        />
      </Form.Group>
    </div>
  );
};

export default NavigationSettings;
