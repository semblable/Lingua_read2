import React, { useState } from 'react';
import { Modal, ListGroup, Button, Spinner } from 'react-bootstrap';
import { FOLDER_COLORS, type FolderColor } from './FolderCard';
import type { LibraryFolder } from '../../utils/store';

interface MoveToFolderModalProps {
  show: boolean;
  onHide: () => void;
  folders: LibraryFolder[];
  onMove: (folderId: number | null) => Promise<void> | void;
  itemCount: number;
}

const MoveToFolderModal = ({ show, onHide, folders, onMove, itemCount }: MoveToFolderModalProps) => {
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null); // null = root
  const [submitting, setSubmitting] = useState(false);

  // Build folder tree from flat list
  const rootFolders = folders.filter((f: LibraryFolder) => !f.parentFolderId);
  const getChildren = (parentId: number | undefined): LibraryFolder[] =>
    folders.filter((f: LibraryFolder) => f.parentFolderId === parentId);

  const handleMove = async () => {
    setSubmitting(true);
    try {
      await onMove(selectedFolderId);
      onHide();
    } catch (err) {
      // handled by parent
    } finally {
      setSubmitting(false);
    }
  };

  const handleExited = () => {
    setSelectedFolderId(null);
  };

  const getFolderColor = (folder: LibraryFolder): string => {
    if (!folder.color) return '#6c757d';
    return FOLDER_COLORS[folder.color as FolderColor] || folder.color;
  };

  const selectedStyle: React.CSSProperties = {
    outline: '2px solid #0d6efd',
    outlineOffset: '-2px',
    fontWeight: 600
  };

  const renderFolder = (folder: LibraryFolder, depth: number = 0): React.ReactNode => {
    const isSelected = selectedFolderId === folder.folderId;
    return (
      <React.Fragment key={folder.folderId}>
        <ListGroup.Item
          action
          onClick={() => setSelectedFolderId(folder.folderId ?? null)}
          style={{ paddingLeft: `${1 + depth * 1.5}rem`, ...(isSelected ? selectedStyle : {}) }}
          className="d-flex align-items-center"
        >
          <i className="bi bi-folder-fill me-2" style={{ color: getFolderColor(folder) }}></i>
          {folder.name}
          <span className="ms-auto d-flex align-items-center gap-2">
            {(folder.itemCount ?? 0) > 0 && <small className="text-muted">{folder.itemCount}</small>}
            {isSelected && <i className="bi bi-check-circle-fill text-primary"></i>}
          </span>
        </ListGroup.Item>
        {getChildren(folder.folderId).map((child: LibraryFolder) => renderFolder(child, depth + 1))}
      </React.Fragment>
    );
  };

  return (
    <Modal show={show} onHide={onHide} onExited={handleExited} centered>
      <Modal.Header closeButton>
        <Modal.Title>Move {itemCount} item{itemCount !== 1 ? 's' : ''}</Modal.Title>
      </Modal.Header>
      <Modal.Body style={{ maxHeight: '400px', overflowY: 'auto' }}>
        <ListGroup variant="flush">
          {(() => {
            const isSelected = selectedFolderId === null;
            return (
              <ListGroup.Item
                action
                onClick={() => setSelectedFolderId(null)}
                style={isSelected ? selectedStyle : {}}
                className="d-flex align-items-center"
              >
                <i className="bi bi-house me-2"></i>
                Library Root
                {isSelected && <i className="bi bi-check-circle-fill text-primary ms-auto"></i>}
              </ListGroup.Item>
            );
          })()}
          {rootFolders.map((folder: LibraryFolder) => renderFolder(folder))}
        </ListGroup>
        {folders.length === 0 && (
          <p className="text-muted text-center py-3">
            No folders yet. Create one first.
          </p>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>Cancel</Button>
        <Button variant="primary" onClick={handleMove} disabled={submitting}>
          {submitting ? <><Spinner size="sm" className="me-1" />Moving...</> : 'Move Here'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default MoveToFolderModal;
