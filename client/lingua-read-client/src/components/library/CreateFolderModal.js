import React, { useState } from 'react';
import { Modal, Form, Button } from 'react-bootstrap';
import { FOLDER_COLORS } from './FolderCard';

const CreateFolderModal = ({ show, onHide, onSubmit, parentFolderId = null }) => {
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit(name.trim(), parentFolderId, color || null);
      setName('');
      setColor('');
      onHide();
    } catch (err) {
      // error handled by parent
    } finally {
      setSubmitting(false);
    }
  };

  const handleExited = () => {
    setName('');
    setColor('');
  };

  return (
    <Modal show={show} onHide={onHide} onExited={handleExited} centered>
      <Form onSubmit={handleSubmit}>
        <Modal.Header closeButton>
          <Modal.Title>Create Folder</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-3">
            <Form.Label>Folder Name</Form.Label>
            <Form.Control
              type="text"
              placeholder="e.g., Grammar Course, News Articles..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={200}
              required
            />
          </Form.Group>
          <Form.Group>
            <Form.Label>Color (optional)</Form.Label>
            <div className="d-flex gap-2 flex-wrap">
              {Object.entries(FOLDER_COLORS).map(([colorName, colorValue]) => (
                <span
                  key={colorName}
                  onClick={() => setColor(color === colorName ? '' : colorName)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    backgroundColor: colorValue,
                    display: 'inline-block',
                    cursor: 'pointer',
                    border: color === colorName ? '3px solid #000' : '3px solid transparent',
                    transition: 'border-color 0.15s'
                  }}
                  title={colorName}
                ></span>
              ))}
            </div>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onHide}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!name.trim() || submitting}>
            {submitting ? 'Creating...' : 'Create Folder'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default CreateFolderModal;
