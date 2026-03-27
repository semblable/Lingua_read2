import React, { useState } from 'react';
import { Card, Dropdown } from 'react-bootstrap';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const FOLDER_COLORS = {
  blue: '#4A90D9',
  green: '#5CB85C',
  orange: '#F0AD4E',
  red: '#D9534F',
  purple: '#9B59B6',
  teal: '#1ABC9C',
  pink: '#E91E63',
  yellow: '#F1C40F'
};

const FolderCard = ({ folder, onClick, onRename, onDelete, onChangeColor, isOver, isSelected, onSelect }) => {
  const [showDropdown, setShowDropdown] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: `folder-${folder.folderId}`,
    data: { type: 'folder', item: folder }
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: 'pointer'
  };

  const folderColor = folder.color ? (FOLDER_COLORS[folder.color] || folder.color) : '#6c757d';

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <Card
        className={`h-100 shadow-sm ${isOver ? 'border-primary border-2' : ''}`}
        onClick={() => onClick(folder.folderId)}
        style={{ borderLeft: `4px solid ${folderColor}` }}
      >
        <Card.Body className="d-flex align-items-center py-3">
          <div
            className="me-3 d-flex align-items-center justify-content-center"
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            style={{ cursor: 'grab', color: '#adb5bd' }}
          >
            <i className="bi bi-grip-vertical" style={{ fontSize: '1.2rem' }}></i>
          </div>
          <i
            className="bi bi-folder-fill me-3"
            style={{ fontSize: '1.5rem', color: folderColor }}
          ></i>
          <div className="flex-grow-1 min-width-0">
            <div className="fw-semibold text-truncate">{folder.name}</div>
            {folder.itemCount > 0 && (
              <small className="text-muted">{folder.itemCount} item{folder.itemCount !== 1 ? 's' : ''}</small>
            )}
          </div>
          <div className="form-check me-2" onClick={(e) => e.stopPropagation()}>
            <input
              className="form-check-input"
              type="checkbox"
              checked={isSelected}
              onChange={() => onSelect(folder.folderId, 'folder')}
            />
          </div>
          <Dropdown
            show={showDropdown}
            onToggle={setShowDropdown}
            onClick={(e) => e.stopPropagation()}
          >
            <Dropdown.Toggle
              variant="link"
              className="text-muted p-0 no-caret"
              bsPrefix="btn"
            >
              <i className="bi bi-three-dots-vertical"></i>
            </Dropdown.Toggle>
            <Dropdown.Menu align="end">
              <Dropdown.Item onClick={() => { setShowDropdown(false); onRename(folder); }}>
                <i className="bi bi-pencil me-2"></i>Rename
              </Dropdown.Item>
              <Dropdown.Header>Color</Dropdown.Header>
              <Dropdown.Item className="d-flex gap-2 flex-wrap px-3">
                {Object.entries(FOLDER_COLORS).map(([name, color]) => (
                  <span
                    key={name}
                    onClick={(e) => { e.stopPropagation(); setShowDropdown(false); onChangeColor(folder.folderId, name); }}
                    style={{
                      width: 20, height: 20, borderRadius: '50%', backgroundColor: color,
                      display: 'inline-block', cursor: 'pointer',
                      border: folder.color === name ? '2px solid #000' : '2px solid transparent'
                    }}
                    title={name}
                  ></span>
                ))}
                <span
                  onClick={(e) => { e.stopPropagation(); setShowDropdown(false); onChangeColor(folder.folderId, ''); }}
                  style={{
                    width: 20, height: 20, borderRadius: '50%', backgroundColor: '#ccc',
                    display: 'inline-block', cursor: 'pointer'
                  }}
                  title="No color"
                >
                  <i className="bi bi-x" style={{ fontSize: '0.7rem', lineHeight: '20px', display: 'block', textAlign: 'center' }}></i>
                </span>
              </Dropdown.Item>
              <Dropdown.Divider />
              <Dropdown.Item className="text-danger" onClick={() => { setShowDropdown(false); onDelete(folder); }}>
                <i className="bi bi-trash me-2"></i>Delete
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>
        </Card.Body>
      </Card>
    </div>
  );
};

export { FOLDER_COLORS };
export default FolderCard;
