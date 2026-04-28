import React from 'react';
import { Form } from 'react-bootstrap';

const NavigationSettings = ({ settings, handleChange }) => {
  return (
    <div className="settings-control-group">
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
