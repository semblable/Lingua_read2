import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AudiobookPlayer from '../components/AudiobookPlayer';
import {
  getAudiobookProgress,
  updateAudiobookProgress,
  getAudioLessonProgress,
  updateAudioLessonProgress,
  logListeningActivity
} from '../utils/api';

jest.mock('../utils/api', () => ({
  getAudiobookProgress: jest.fn(),
  updateAudiobookProgress: jest.fn(),
  getAudioLessonProgress: jest.fn(),
  updateAudioLessonProgress: jest.fn(),
  logListeningActivity: jest.fn()
}));

describe('AudiobookPlayer', () => {
  beforeEach(() => {
    // Mock HTMLMediaElement methods that JSDOM doesn't implement
    window.HTMLMediaElement.prototype.play = jest.fn().mockResolvedValue();
    window.HTMLMediaElement.prototype.pause = jest.fn();
    window.HTMLMediaElement.prototype.load = jest.fn();

    getAudiobookProgress.mockReset();
    updateAudiobookProgress.mockReset();
    getAudioLessonProgress.mockReset();
    updateAudioLessonProgress.mockReset();
    logListeningActivity.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('book mode calls API to restore progress', async () => {
    getAudiobookProgress.mockResolvedValue({
      currentAudiobookTrackId: 'track-2',
      currentAudiobookPosition: 12
    });

    const book = {
      bookId: 10,
      languageId: 3,
      audiobookTracks: [
        { trackId: 'track-1', filePath: 'audio/track-1.mp3' },
        { trackId: 'track-2', filePath: 'audio/track-2.mp3' }
      ]
    };

    render(<AudiobookPlayer type="book" book={book} />);

    // Wait for the component to load and call getAudiobookProgress
    await waitFor(() => {
      expect(getAudiobookProgress).toHaveBeenCalledWith(10);
    });

    // Verify the UI is rendered
    await waitFor(() => {
      expect(screen.getByTitle(/Play/)).toBeInTheDocument();
    });
  });

  test('lesson mode calls API to restore progress', async () => {
    getAudioLessonProgress.mockResolvedValue({ currentPosition: 30 });

    const onTimeUpdate = jest.fn();

    render(
      <AudiobookPlayer
        type="lesson"
        audioSrc="https://example.com/lesson.mp3"
        textId={42}
        languageId={5}
        onTimeUpdate={onTimeUpdate}
      />
    );

    // Wait for the component to load and call getAudioLessonProgress
    await waitFor(() => {
      expect(getAudioLessonProgress).toHaveBeenCalledWith(42);
    });

    // Verify the UI is rendered
    await waitFor(() => {
      expect(screen.getByTitle(/Play/)).toBeInTheDocument();
    });
  });

  test('manual pause cancels active segment playback boundary', async () => {
    getAudioLessonProgress.mockResolvedValue({ currentPosition: 0 });

    const { container } = render(
      <AudiobookPlayer
        type="lesson"
        audioSrc="https://example.com/lesson.mp3"
        textId={42}
        languageId={5}
        segmentPlaybackRequest={{
          requestId: 'segment-1',
          startTime: 5,
          endTime: 10,
          repeatCount: 2
        }}
      />
    );

    await waitFor(() => {
      expect(getAudioLessonProgress).toHaveBeenCalledWith(42);
    });
    await waitFor(() => {
      expect(screen.getByTitle('+10s')).toBeInTheDocument();
    });

    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();

    act(() => {
      fireEvent.pause(audio);
    });

    expect(window.HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();

    act(() => {
      Object.defineProperty(audio, 'currentTime', {
        configurable: true,
        writable: true,
        value: 10
      });
      fireEvent.timeUpdate(audio);
    });

    expect(window.HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
  });

  test('manual seek cancels active segment playback and reports new time', async () => {
    getAudioLessonProgress.mockResolvedValue({ currentPosition: 0 });
    const onTimeUpdate = jest.fn();

    const { container } = render(
      <AudiobookPlayer
        type="lesson"
        audioSrc="https://example.com/lesson.mp3"
        textId={42}
        languageId={5}
        onTimeUpdate={onTimeUpdate}
        segmentPlaybackRequest={{
          requestId: 'segment-2',
          startTime: 0,
          endTime: 5,
          repeatCount: 1
        }}
      />
    );

    await waitFor(() => {
      expect(getAudioLessonProgress).toHaveBeenCalledWith(42);
    });

    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();
    Object.defineProperty(audio, 'duration', {
      configurable: true,
      writable: true,
      value: 100
    });

    await waitFor(() => {
      expect(screen.getByTitle('+10s')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('+10s'));

    expect(onTimeUpdate).toHaveBeenCalledWith(10);

    act(() => {
      Object.defineProperty(audio, 'currentTime', {
        configurable: true,
        writable: true,
        value: 10
      });
      fireEvent.timeUpdate(audio);
    });

    expect(window.HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
  });

  test('does not reload when the same lesson source resolves to the same URL', async () => {
    getAudioLessonProgress.mockResolvedValue({ currentPosition: 0 });

    const { rerender } = render(
      <AudiobookPlayer
        type="lesson"
        audioSrc="/lesson.mp3"
        textId={42}
        languageId={5}
      />
    );

    await waitFor(() => {
      expect(getAudioLessonProgress).toHaveBeenCalledWith(42);
    });

    expect(window.HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(1);

    rerender(
      <AudiobookPlayer
        type="lesson"
        audioSrc={`${window.location.origin}/lesson.mp3`}
        textId={42}
        languageId={5}
      />
    );

    await waitFor(() => {
      expect(screen.getByTitle(/Play/)).toBeInTheDocument();
    });

    expect(window.HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(1);
  });

  test('ignores abort-like segment playback failures', async () => {
    getAudioLessonProgress.mockResolvedValue({ currentPosition: 0 });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    const abortError = Object.assign(new Error('The fetching process for the media resource was aborted.'), {
      name: 'AbortError'
    });
    window.HTMLMediaElement.prototype.play = jest.fn().mockRejectedValue(abortError);

    render(
      <AudiobookPlayer
        type="lesson"
        audioSrc="https://example.com/lesson.mp3"
        textId={42}
        languageId={5}
        segmentPlaybackRequest={{
          requestId: 'segment-abort',
          startTime: 5,
          endTime: 10,
          repeatCount: 1
        }}
      />
    );

    await waitFor(() => {
      expect(getAudioLessonProgress).toHaveBeenCalledWith(42);
    });

    await waitFor(() => {
      expect(debugSpy).toHaveBeenCalled();
    });

    expect(warnSpy).not.toHaveBeenCalledWith('Segment playback failed', abortError);
    expect(screen.queryByText('Error loading audio.')).not.toBeInTheDocument();
  });

  test('ignores aborted media error events during source replacement', async () => {
    getAudioLessonProgress.mockResolvedValue({ currentPosition: 0 });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});

    const { container } = render(
      <AudiobookPlayer
        type="lesson"
        audioSrc="https://example.com/lesson.mp3"
        textId={42}
        languageId={5}
      />
    );

    await waitFor(() => {
      expect(getAudioLessonProgress).toHaveBeenCalledWith(42);
    });

    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();

    Object.defineProperty(audio, 'error', {
      configurable: true,
      value: {
        code: 1,
        message: 'The fetching process for the media resource was aborted by the user agent at the user\'s request.'
      }
    });

    fireEvent.error(audio);

    expect(debugSpy).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalledWith(
      'Audio Error:',
      expect.objectContaining({
        mediaErrorCode: 1
      })
    );
    expect(screen.queryByText('Error loading audio.')).not.toBeInTheDocument();
  });
});
