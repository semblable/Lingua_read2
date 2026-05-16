import React from 'react';
import { Card, ProgressBar, Badge } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import type { LibraryBook, SelectableType } from '../../utils/store';

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
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: `book-${book.bookId}`,
    data: { type: 'book', item: book }
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} data-selectable-id={book.bookId} data-selectable-type="book">
      <Card
        className={`h-100 shadow-sm book-card ${isSelected ? 'border-primary border-2' : ''}`}
        onClick={(e) => {
          if ((e.ctrlKey || e.metaKey || e.shiftKey) && onItemClick) {
            e.preventDefault();
            onItemClick(book.bookId!, 'book', e); // bookId is always server-provided on rendered cards
          }
        }}
      >
        {book.coverImagePath && (
          <Card.Img
            variant="top"
            src={normalizeCoverUrl(book.coverImagePath) ?? undefined}
            alt={`${book.title} cover`}
            style={{ objectFit: 'cover', maxHeight: '180px' }}
          />
        )}
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
                <i className="bi bi-book me-1 text-primary"></i>
                {book.isFinished && <i className="bi bi-check-circle-fill text-success me-1" title="Completed"></i>}
                {book.title}
              </Card.Title>
            </div>
            <div className="form-check ms-1" onClick={(e) => e.stopPropagation()}>
              <input
                className="form-check-input"
                type="checkbox"
                checked={isSelected}
                onChange={() => onSelect(book.bookId!, 'book')}
              />
            </div>
          </div>
          <small className="text-muted mb-2">{book.languageName}</small>

          {book.partCount > 0 && (
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
            {book.totalWords > 0 && book.unknownWordPercentage != null && (
              <span className="ms-2" title={`${book.unknownWords} of ${book.totalWords} word tokens not yet known`}>
                · {book.unknownWordPercentage.toFixed(1)}% new
              </span>
            )}
            {book.tags?.length > 0 && (
              <span className="ms-2">
                {book.tags.map((tag: string) => (
                  <Badge key={tag} bg="secondary" className="me-1" style={{ fontSize: '0.65rem' }}>{tag}</Badge>
                ))}
              </span>
            )}
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
