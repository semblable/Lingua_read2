import React, { useState, useEffect } from 'react';
import { Modal, Form, Button } from 'react-bootstrap';

const RenameFolderModal = ({ show, onHide, folder, onSubmit }) => {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (folder) setName(folder.name);
  }, [folder]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !folder) return;
    setSubmitting(true);
    try {
      await onSubmit(folder.folderId, { name: name.trim() });
      onHide();
    } catch (err) {
      // handled by parent
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Form onSubmit={handleSubmit}>
        <Modal.Header closeButton>
          <Modal.Title>Rename Folder</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Control
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            maxLength={200}
            required
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onHide}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!name.trim() || submitting}>
            {submitting ? 'Saving...' : 'Save'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default RenameFolderModal;
