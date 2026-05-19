import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import MobileLessonHeader from '../components/reader/MobileLessonHeader';

const baseProps = (overrides = {}) => ({
  isMobile: true,
  showMobileHeader: false,
  setShowMobileHeader: vi.fn(),
  showMoreControls: false,
  setShowMoreControls: vi.fn(),
  text: { title: 'Lesson Title' },
  primaryControls: <div data-testid="primary-controls">primary</div>,
  secondaryControls: <div data-testid="secondary-controls">secondary</div>,
  readerLessonActions: <div data-testid="reader-actions">reader-actions</div>,
  isAudioLesson: false,
  isAudioPlaying: false,
  toggleAudioPlayback: vi.fn(),
  ...overrides
});

describe('MobileLessonHeader', () => {
  test('returns null when not on mobile', () => {
    const { container } = render(<MobileLessonHeader {...baseProps({ isMobile: false })} />);
    expect(container.firstChild).toBeNull();
  });

  test('renders the FAB and topbar with the lesson title', () => {
    render(<MobileLessonHeader {...baseProps()} />);
    expect(screen.getByRole('button', { name: /Open lesson controls/i })).toBeInTheDocument();
    expect(screen.getByText('Lesson Title')).toBeInTheDocument();
  });

  test('tapping the FAB toggles via setShowMobileHeader with an updater', () => {
    const setShowMobileHeader = vi.fn();
    render(<MobileLessonHeader {...baseProps({ setShowMobileHeader })} />);
    fireEvent.click(screen.getByRole('button', { name: /Open lesson controls/i }));
    expect(setShowMobileHeader).toHaveBeenCalledTimes(1);
    expect(typeof setShowMobileHeader.mock.calls[0][0]).toBe('function');
  });

  test('shows a Play button when isAudioLesson is true and toggles via toggleAudioPlayback', () => {
    const toggleAudioPlayback = vi.fn();
    render(
      <MobileLessonHeader
        {...baseProps({ isAudioLesson: true, toggleAudioPlayback })}
      />
    );
    const playBtn = screen.getByRole('button', { name: /Play audio/i });
    fireEvent.click(playBtn);
    expect(toggleAudioPlayback).toHaveBeenCalledTimes(1);
  });

  test('shows a Pause button when audio is currently playing', () => {
    render(
      <MobileLessonHeader
        {...baseProps({ isAudioLesson: true, isAudioPlaying: true })}
      />
    );
    expect(screen.getByRole('button', { name: /Pause audio/i })).toBeInTheDocument();
  });

  test('Close button calls setShowMobileHeader(false) and setShowMoreControls(false)', () => {
    const setShowMobileHeader = vi.fn();
    const setShowMoreControls = vi.fn();
    render(
      <MobileLessonHeader
        {...baseProps({
          showMobileHeader: true,
          setShowMobileHeader,
          setShowMoreControls
        })}
      />
    );
    // Both the FAB (aria-label "Close lesson controls") and the topbar's
    // explicit Close button match by accessible name when the header is open.
    // Match by visible text "Close" — only the topbar button has it.
    fireEvent.click(screen.getByText('Close'));
    expect(setShowMobileHeader).toHaveBeenCalledWith(false);
    expect(setShowMoreControls).toHaveBeenCalledWith(false);
  });

  test('Menu button toggles setShowMoreControls', () => {
    const setShowMoreControls = vi.fn();
    render(
      <MobileLessonHeader
        {...baseProps({ showMobileHeader: true, setShowMoreControls })}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Menu/i }));
    expect(setShowMoreControls).toHaveBeenCalledTimes(1);
    expect(typeof setShowMoreControls.mock.calls[0][0]).toBe('function');
  });
});
