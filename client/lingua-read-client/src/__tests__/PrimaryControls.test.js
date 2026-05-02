import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import PrimaryControls from '../components/reader/PrimaryControls';

const baseProps = {
  displayMode: 'audio',
  setDisplayMode: jest.fn(),
  isSentenceMode: false,
  setSentenceModeEnabled: jest.fn(),
  completing: false,
  nextTextId: null,
  navigate: jest.fn(),
  handleCompleteLesson: jest.fn(),
  handleCompleteLessonNoStats: jest.fn(),
};

describe('PrimaryControls — Finish (no stats) button', () => {
  test('renders for standalone audio lessons and triggers handler', () => {
    render(
      <PrimaryControls
        {...baseProps}
        isAudioLesson={true}
        text={{ textId: 1, bookId: null }}
      />
    );

    const btn = screen.getByRole('button', { name: /finish \(no stats\)/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(baseProps.handleCompleteLessonNoStats).toHaveBeenCalledTimes(1);
    expect(baseProps.handleCompleteLesson).not.toHaveBeenCalled();
  });

  test('does not render for non-audio lessons', () => {
    render(
      <PrimaryControls
        {...baseProps}
        isAudioLesson={false}
        text={{ textId: 1, bookId: null }}
      />
    );

    expect(screen.queryByRole('button', { name: /finish \(no stats\)/i })).toBeNull();
  });

  test('does not render for audio lessons inside a book', () => {
    render(
      <PrimaryControls
        {...baseProps}
        isAudioLesson={true}
        text={{ textId: 1, bookId: 99 }}
      />
    );

    expect(screen.queryByRole('button', { name: /finish \(no stats\)/i })).toBeNull();
    // Standard "Complete Lesson" is also gated to !bookId, so it shouldn't be here either.
    expect(screen.queryByRole('button', { name: /^complete lesson$/i })).toBeNull();
  });
});
