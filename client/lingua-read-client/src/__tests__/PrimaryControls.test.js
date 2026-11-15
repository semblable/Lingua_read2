import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import PrimaryControls, { ReaderNavigation } from '../components/reader/PrimaryControls';

const baseProps = () => ({
  isAudioLesson: false,
  displayMode: 'audio',
  setDisplayMode: vi.fn(),
  isSentenceMode: false,
  setSentenceModeEnabled: vi.fn(),
});

describe('PrimaryControls', () => {
  test('contains reading modes without completion, navigation, or no-stats actions', () => {
    const props = baseProps();
    render(<PrimaryControls {...props} isAudioLesson />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Sentence Mode' }));
    expect(props.setSentenceModeEnabled).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Text View' }));
    expect(props.setDisplayMode.mock.calls[0][0]('audio')).toBe('text');
    expect(screen.queryByRole('button', { name: /finish|complete|library|book/i })).not.toBeInTheDocument();
  });

  test('marks the active sentence mode without an audio toggle on plain text', () => {
    render(<PrimaryControls {...baseProps()} isSentenceMode />);
    expect(screen.getByRole('button', { name: 'Sentence Mode' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

describe('ReaderNavigation', () => {
  test.each([[12, '/library/12'], [null, '/library']])('returns standalone texts to their folder (%s)', (folderId, path) => {
    const navigate = vi.fn();
    render(<ReaderNavigation text={{ bookId: null, folderId }} navigate={navigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to Library' }));
    expect(navigate).toHaveBeenCalledWith(path);
  });

  test('returns book parts to their book', () => {
    const navigate = vi.fn();
    render(<ReaderNavigation text={{ bookId: 99 }} navigate={navigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to Book' }));
    expect(navigate).toHaveBeenCalledWith('/books/99');
  });
});
