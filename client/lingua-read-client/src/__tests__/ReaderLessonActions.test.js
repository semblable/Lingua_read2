import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ReaderLessonActions from '../components/reader/ReaderLessonActions';

const baseProps = (overrides = {}) => ({
  text: { bookId: 3 },
  isAudioLesson: false,
  previousTextId: null,
  nextTextId: null,
  isLastBookPart: false,
  completing: false,
  navigate: vi.fn(),
  handleCompleteLesson: vi.fn(),
  ...overrides
});

describe('ReaderLessonActions', () => {
  test('shows Complete Lesson while the book part list has not loaded yet', () => {
    // nextTextId is null here too, which used to be read as "last part".
    render(<ReaderLessonActions {...baseProps()} />);

    expect(screen.getByRole('button', { name: 'Complete Lesson' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish Book' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next Text' })).toBeDisabled();
  });

  test('shows Finish Book on the last part of a book', () => {
    render(<ReaderLessonActions {...baseProps({ previousTextId: 19, isLastBookPart: true })} />);

    expect(screen.getByRole('button', { name: 'Finish Book' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous Text' })).toBeEnabled();
  });

  test('navigates to the next part once it is known', () => {
    const navigate = vi.fn();
    render(<ReaderLessonActions {...baseProps({ nextTextId: 21, navigate })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next Text' }));

    expect(navigate).toHaveBeenCalledWith('/texts/21');
    expect(screen.getByRole('button', { name: 'Complete Lesson' })).toBeInTheDocument();
  });
});
