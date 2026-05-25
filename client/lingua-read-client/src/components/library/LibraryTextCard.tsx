import React from 'react';
import { Card, Badge } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatDate } from '../../utils/helpers';
import type { LibraryText, SelectableType } from '../../utils/store';
import ComprehensibilityBadge from '../shared/ComprehensibilityBadge';

interface LibraryTextCardProps {
  text: LibraryText;
  isSelected: boolean;
  onSelect: (id: number, type: SelectableType) => void;
  onItemClick?: (id: number, type: SelectableType, e: React.MouseEvent) => void;
}

const LibraryTextCard = ({ text, isSelected, onSelect, onItemClick }: LibraryTextCardProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: `text-${text.textId}`,
    data: { type: 'text', item: text }
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} data-selectable-id={text.textId} data-selectable-type="text">
      <Card
        className={`h-100 shadow-sm ${isSelected ? 'border-primary border-2' : ''}`}
        onClick={(e) => {
          if ((e.ctrlKey || e.metaKey || e.shiftKey) && onItemClick) {
            e.preventDefault();
            onItemClick(text.textId!, 'text', e); // textId is always server-provided on rendered cards
          }
        }}
      >
        <Card.Body className="d-flex flex-column">
          <div className="d-flex align-items-start mb-1">
            <div
              className="me-2 d-flex align-items-center"
              {...listeners}
              style={{ cursor: 'grab', color: '#adb5bd' }}
            >
              <i className="bi bi-grip-vertical"></i>
            </div>
            <div className="flex-grow-1" style={{ minWidth: 0 }}>
              <Card.Title as="h6" className="text-truncate mb-0">
                {text.isAudioLesson && <i className="bi bi-headphones me-1" title="Audio Lesson"></i>}
                {text.isFinished && <i className="bi bi-check-circle-fill text-success me-1" title="Completed"></i>}
                {text.title}
              </Card.Title>
            </div>
            <div className="form-check ms-1" onClick={(e) => e.stopPropagation()}>
              <input
                className="form-check-input"
                type="checkbox"
                checked={isSelected}
                onChange={() => onSelect(text.textId!, 'text')}
              />
            </div>
          </div>
          <div className="d-flex align-items-center gap-2 mb-2">
            <small className="text-muted">{text.languageName}</small>
            {text.tag && <Badge bg="secondary" style={{ fontSize: '0.65rem' }}>{text.tag}</Badge>}
          </div>
          <small className="text-muted mt-auto">
            {formatDate(text.createdAt ?? '')}
          </small>
          <div className="mt-1">
            <ComprehensibilityBadge
              totalWords={text.totalWords}
              unknownWords={text.unknownWords}
              unknownWordPercentage={text.unknownWordPercentage}
            />
          </div>
        </Card.Body>
        <Card.Footer className="p-2 bg-transparent border-top-0">
          <Link to={`/texts/${text.textId}`} className="btn btn-outline-primary btn-sm w-100">
            {text.isAudioLesson ? 'Listen' : 'Read'}
          </Link>
        </Card.Footer>
      </Card>
    </div>
  );
};

export default LibraryTextCard;
