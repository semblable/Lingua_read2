import React from 'react';
import { Card, ProgressBar, Badge } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import type { LibraryBook, SelectableType } from '../../utils/store';
import ComprehensibilityBadge from '../shared/ComprehensibilityBadge';
import { CARD_INTERACTIVE_SELECTOR } from './cardClicks';

const normalizeCoverUrl = (value: string | null | undefined): string | null => {
  if (!value) return null;
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('/')) return value;
  return `/${value.replace(/^\/+/, '')}`;
};

interface LibraryBookCardProps {
  book: LibraryBook;
  isSelected: boolean;
  onSelect: (id: number, type: SelectableType) => void;
  onItemClick?: (id: number, type: SelectableType, e: React.MouseEvent) => void;
}

const LibraryBookCard = ({ book, isSelected, onSelect, onItemClick }: LibraryBookCardProps) => {
  const navigate = useNavigate();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: `book-${book.bookId}`,
    data: { type: 'book', id: book.bookId, item: book }
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  };

  return (
    <div ref={setNodeRef} style={style} data-selectable-id={book.bookId} data-selectable-type="book">
      <Card
        className={`h-100 shadow-sm book-card ${isSelected ? 'border-primary border-2' : ''}`}
        style={{ cursor: 'pointer' }}
        onClick={(e) => {
          if ((e.ctrlKey || e.metaKey || e.shiftKey) && onItemClick) {
            e.preventDefault();
            onItemClick(book.bookId!, 'book', e); // bookId is always server-provided on rendered cards
            return;
          }
          if ((e.target as HTMLElement).closest(CARD_INTERACTIVE_SELECTOR)) return;
          navigate(`/books/${book.bookId}`);
        }}
      >
        {book.coverImagePath ? (
          <Card.Img
            variant="top"
            src={normalizeCoverUrl(book.coverImagePath) ?? undefined}
            alt={`${book.title} cover`}
            loading="lazy"
            className="library-cover"
          />
        ) : (
          <div className="card-img-top library-cover library-cover-placeholder" aria-hidden="true">
            <i className="bi bi-book"></i>
          </div>
        )}
        <Card.Body className="d-flex flex-column">
          <div className="d-flex align-items-start mb-1">
            <div
              ref={setActivatorNodeRef}
              className="me-2 d-flex align-items-center"
              data-drag-handle
              {...attributes}
              {...listeners}
              aria-label={`Move ${book.title ?? 'book'}`}
              style={{ cursor: 'grab', color: '#adb5bd' }}
            >
              <i className="bi bi-grip-vertical"></i>
            </div>
            <div className="flex-grow-1" style={{ minWidth: 0 }}>
              <Card.Title as="h6" className="text-truncate mb-0">
                <i className="bi bi-book me-1 text-primary"></i>
                {book.isFinished && <i className="bi bi-check-circle-fill text-success me-1" title="Completed"></i>}
                {book.title}
              </Card.Title>
              {book.author && (
                <small className="text-muted d-block text-truncate" title={book.author}>{book.author}</small>
              )}
            </div>
            <div className="form-check ms-1" onClick={(e) => e.stopPropagation()}>
              <input
                className="form-check-input"
                type="checkbox"
                checked={isSelected}
                onChange={() => onSelect(book.bookId!, 'book')}
                aria-label={`Select ${book.title ?? 'book'}`}
              />
            </div>
          </div>
          <small className="text-muted mb-2">{book.languageName}</small>

          {(book.partCount ?? 0) > 0 && (
            <div className="mb-2">
              <ProgressBar
                now={book.completionPercentage}
                className="themed-progress-bar"
                style={{ height: '0.5rem' }}
                title={`${book.finishedPartCount}/${book.partCount} parts finished`}
              />
            </div>
          )}

          <div className="text-muted small mt-auto">
            {book.finishedPartCount}/{book.partCount} part{book.partCount !== 1 ? 's' : ''}
            {book.tags && book.tags.length > 0 && (
              <span className="ms-2">
                {book.tags.map((tag: string) => (
                  <Badge key={tag} bg="secondary" className="me-1" style={{ fontSize: '0.65rem' }}>{tag}</Badge>
                ))}
              </span>
            )}
          </div>
          <div className="mt-1">
            <ComprehensibilityBadge
              totalWords={book.totalWords}
              unknownWords={book.unknownWords}
              unknownWordPercentage={book.unknownWordPercentage}
            />
          </div>
        </Card.Body>
        <Card.Footer className="d-flex p-2 bg-transparent border-top-0">
          <Link to={`/books/${book.bookId}`} className="btn btn-outline-primary btn-sm flex-grow-1 me-1">
            View
          </Link>
          {book.lastReadTextId ? (
            <Link to={`/texts/${book.lastReadTextId}`} className="btn btn-primary btn-sm flex-grow-1">
              Continue
            </Link>
          ) : (
            <Link to={`/books/${book.bookId}`} className="btn btn-primary btn-sm flex-grow-1">
              Start
            </Link>
          )}
        </Card.Footer>
      </Card>
    </div>
  );
};

export default LibraryBookCard;
