import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import LessonHeader from '../components/reader/LessonHeader';

vi.mock('../components/AudiobookPlayer', () => ({
  default: () => <div data-testid="audiobook-player">audio-player</div>
}));

const baseProps = (overrides = {}) => ({
  isMobile: false,
  text: { title: 'My Lesson', languageName: 'Spanish', languageId: 1 },
  words: [{ wordId: 1 }, { wordId: 2 }],
  isAudioLesson: false,
  book: null,
  primaryControls: <div data-testid="primary-controls">primary</div>,
  secondaryControls: <div data-testid="secondary-controls">secondary</div>,
  readerLessonActions: <div data-testid="reader-actions">reader-actions</div>,
  translateUnknownError: null,
  audioSrc: null,
  textId: 1,
  audioRef: { current: null },
  onTimeUpdate: vi.fn(),
  onPlaybackStateChange: vi.fn(),
  segmentPlaybackRequest: null,
  showDesktopLessonControls: false,
  setShowDesktopLessonControls: vi.fn(),
  ...overrides
});

describe('LessonHeader', () => {
  test('returns null on mobile', () => {
    const { container } = render(<LessonHeader {...baseProps({ isMobile: true })} />);
    expect(container.firstChild).toBeNull();
  });

  test('returns null when text is null', () => {
    const { container } = render(<LessonHeader {...baseProps({ text: null })} />);
    expect(container.firstChild).toBeNull();
  });

  test('renders the title and language meta line', () => {
    render(<LessonHeader {...baseProps()} />);
    expect(screen.getByText('My Lesson')).toBeInTheDocument();
    expect(screen.getByText(/Lang: Spanish/)).toBeInTheDocument();
    expect(screen.getByText(/2 words/)).toBeInTheDocument();
  });

  test('Show/Hide toggle calls setShowDesktopLessonControls with an updater', () => {
    const setShowDesktopLessonControls = vi.fn();
    render(<LessonHeader {...baseProps({ setShowDesktopLessonControls })} />);
    fireEvent.click(screen.getByRole('button', { name: /Show lesson controls panel/i }));
    expect(setShowDesktopLessonControls).toHaveBeenCalledTimes(1);
    expect(typeof setShowDesktopLessonControls.mock.calls[0][0]).toBe('function');
  });

  test('renders the expanded controls panel when showDesktopLessonControls is true', () => {
    render(<LessonHeader {...baseProps({ showDesktopLessonControls: true })} />);
    expect(screen.getByTestId('primary-controls')).toBeInTheDocument();
    expect(screen.getByTestId('secondary-controls')).toBeInTheDocument();
    expect(screen.getByTestId('reader-actions')).toBeInTheDocument();
  });

  test('renders an AudiobookPlayer when isAudioLesson and audioSrc are provided', () => {
    render(
      <LessonHeader
        {...baseProps({ isAudioLesson: true, audioSrc: 'audio.mp3' })}
      />
    );
    expect(screen.getByTestId('audiobook-player')).toBeInTheDocument();
  });

  test('renders the translateUnknownError alert when provided', () => {
    render(
      <LessonHeader {...baseProps({ translateUnknownError: 'translate failed' })} />
    );
    expect(screen.getByText('translate failed')).toBeInTheDocument();
  });
});
