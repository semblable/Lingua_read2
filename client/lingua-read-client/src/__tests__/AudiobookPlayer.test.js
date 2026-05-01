import React, { act } from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

const renderReadyLessonPlayer = async (props = {}) => {
  getAudioLessonProgress.mockResolvedValue({ currentPosition: 0 });

  const rendered = render(
    <AudiobookPlayer
      type="lesson"
      audioSrc="https://example.com/lesson.mp3"
      textId={42}
      languageId={5}
      {...props}
    />
  );

  await waitFor(() => {
    expect(screen.getByTitle(/Play/)).toBeInTheDocument();
  });
  await waitFor(() => {
    expect(getAudioLessonProgress).toHaveBeenCalledWith(42);
  });
  await act(async () => {});

  const audio = rendered.container.querySelector('audio');
  expect(audio).not.toBeNull();

  return { ...rendered, audio };
};

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
    localStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    localStorage.clear();
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

  test('book mode prefers fresher local progress over stale non-zero server progress', async () => {
    getAudiobookProgress.mockResolvedValue({
      currentAudiobookTrackId: 'track-1',
      currentAudiobookPosition: 12,
      updatedAt: '2026-05-01T09:59:50.000Z'
    });
    localStorage.setItem('audioPos:book:10', JSON.stringify({
      position: 42,
      trackId: 'track-2',
      trackIndex: 1,
      timestamp: Date.parse('2026-05-01T10:00:00.000Z')
    }));

    const book = {
      bookId: 10,
      languageId: 3,
      audiobookTracks: [
        { trackId: 'track-1', filePath: 'audio/track-1.mp3' },
        { trackId: 'track-2', filePath: 'audio/track-2.mp3' }
      ]
    };

    const { container } = render(<AudiobookPlayer type="book" book={book} />);

    await waitFor(() => {
      expect(screen.getByTitle(/Play/)).toBeInTheDocument();
    });

    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();
    await waitFor(() => {
      expect(audio.getAttribute('src')).toContain('track-2');
    });
    expect(screen.getByText('00:42')).toBeInTheDocument();
  });

  test('book mode saves progress with keepalive on page lifecycle exit', async () => {
    getAudiobookProgress.mockResolvedValue({
      currentAudiobookTrackId: 'track-1',
      currentAudiobookPosition: 0
    });

    const book = {
      bookId: 10,
      languageId: 3,
      audiobookTracks: [
        { trackId: 'track-1', filePath: 'audio/track-1.mp3' },
        { trackId: 'track-2', filePath: 'audio/track-2.mp3' }
      ]
    };

    const { container } = render(<AudiobookPlayer type="book" book={book} />);

    await screen.findByText('Track 1 of 2');

    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();
    await waitFor(() => {
      expect(audio.getAttribute('src')).toContain('track-1');
    });
    Object.defineProperty(audio, 'currentTime', {
      configurable: true,
      writable: true,
      value: 37
    });

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    await waitFor(() => {
      expect(updateAudiobookProgress).toHaveBeenCalledWith(10, expect.objectContaining({
        currentAudiobookTrackId: 'track-1',
        currentAudiobookPosition: 37
      }), {
        keepalive: true
      });
    });
  });

  test('book mode shows the current track number and name', async () => {
    getAudiobookProgress.mockResolvedValue({
      currentAudiobookTrackId: 'track-2',
      currentAudiobookPosition: 0
    });

    const book = {
      bookId: 10,
      languageId: 3,
      audiobookTracks: [
        { trackId: 'track-1', title: 'Chapter 1', filePath: 'audio/track-1.mp3' },
        { trackId: 'track-2', title: 'Chapter 2', filePath: 'audio/track-2.mp3' }
      ]
    };

    render(<AudiobookPlayer type="book" book={book} />);

    await waitFor(() => {
      expect(screen.getByText('Track 2 of 2')).toBeInTheDocument();
      expect(screen.getByText('Chapter 2')).toBeInTheDocument();
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

  test('lesson mode starts loading audio before progress restore resolves', async () => {
    const deferredProgress = createDeferred();
    getAudioLessonProgress.mockReturnValue(deferredProgress.promise);

    render(
      <AudiobookPlayer
        type="lesson"
        audioSrc="https://example.com/lesson.mp3"
        textId={42}
        languageId={5}
      />
    );

    await waitFor(() => {
      expect(getAudioLessonProgress).toHaveBeenCalledWith(42);
      expect(window.HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(1);
    });

    deferredProgress.resolve({ currentPosition: 30 });

    await waitFor(() => {
      expect(screen.getByTitle(/Play/)).toBeInTheDocument();
    });
  });

  test('logs partial listening duration when paused before periodic interval', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const { audio } = await renderReadyLessonPlayer();

    act(() => {
      audio.__lrAllowPlayback = true;
      fireEvent.play(audio);
    });
    await act(async () => {});

    nowSpy.mockReturnValue(9000);
    act(() => {
      fireEvent.pause(audio);
    });

    expect(logListeningActivity).toHaveBeenCalledTimes(1);
    expect(logListeningActivity).toHaveBeenCalledWith(5, 8);
  });

  test('logs periodic chunks and only remaining listening duration on pause', async () => {
    const { audio } = await renderReadyLessonPlayer();
    const intervalCallbacks = [];
    jest.spyOn(window, 'setInterval').mockImplementation((callback) => {
      intervalCallbacks.push(callback);
      return intervalCallbacks.length;
    });
    jest.spyOn(window, 'clearInterval').mockImplementation(() => {});
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);

    act(() => {
      audio.__lrAllowPlayback = true;
      fireEvent.play(audio);
    });
    await act(async () => {});

    nowSpy.mockReturnValue(11000);
    act(() => {
      intervalCallbacks[0]();
    });

    expect(logListeningActivity).toHaveBeenCalledTimes(1);
    expect(logListeningActivity).toHaveBeenCalledWith(5, 10);

    nowSpy.mockReturnValue(14500);
    act(() => {
      fireEvent.pause(audio);
    });

    expect(logListeningActivity).toHaveBeenCalledTimes(2);
    // 3.5s remaining is rounded on force flush (was floor → 3 prior to remainder fix)
    expect(logListeningActivity).toHaveBeenLastCalledWith(5, 4);
  });

  test('flushes pending listening duration on unmount', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const { audio, unmount } = await renderReadyLessonPlayer();

    act(() => {
      audio.__lrAllowPlayback = true;
      fireEvent.play(audio);
    });
    await act(async () => {});

    nowSpy.mockReturnValue(6500);
    unmount();

    expect(logListeningActivity).toHaveBeenCalledTimes(1);
    // 5.5s rounds to 6 on force flush (was floor → 5 prior to remainder fix)
    expect(logListeningActivity).toHaveBeenCalledWith(5, 6);
  });

  test('flushes pending listening duration on page lifecycle exit', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const { audio } = await renderReadyLessonPlayer();

    act(() => {
      audio.__lrAllowPlayback = true;
      fireEvent.play(audio);
    });
    await act(async () => {});

    nowSpy.mockReturnValue(7500);
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(logListeningActivity).toHaveBeenCalledTimes(1);
    // 6.5s rounds to 7 on force flush (was floor → 6 prior to remainder fix)
    expect(logListeningActivity).toHaveBeenLastCalledWith(5, 7, { keepalive: true });
  });

  test('does not accrue listening seconds while audio is buffering', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const { audio } = await renderReadyLessonPlayer();

    act(() => {
      audio.__lrAllowPlayback = true;
      fireEvent.play(audio);
    });
    await act(async () => {});

    // Played 3s, then network stalls.
    nowSpy.mockReturnValue(4000);
    act(() => {
      fireEvent(audio, new Event('waiting'));
    });

    // 6s pass while buffering — should NOT count toward listening time.
    nowSpy.mockReturnValue(10000);
    act(() => {
      fireEvent(audio, new Event('playing'));
    });

    // Play another 4s, then pause.
    nowSpy.mockReturnValue(14000);
    act(() => {
      fireEvent.pause(audio);
    });

    // Total listened: 3s (pre-buffer) + 4s (post-buffer) = 7s.
    // Without the fix this would be 13s (3 + 6 buffer + 4).
    expect(logListeningActivity).toHaveBeenCalledTimes(1);
    expect(logListeningActivity).toHaveBeenCalledWith(5, 7);
  });

  test('preserves sub-second listening remainder across pause and resume', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const { audio } = await renderReadyLessonPlayer();

    act(() => {
      audio.__lrAllowPlayback = true;
      fireEvent.play(audio);
    });
    await act(async () => {});

    // Play 3.4s — rounds to 3, leaves +0.4s residual in pending.
    nowSpy.mockReturnValue(4400);
    act(() => {
      fireEvent.pause(audio);
    });
    expect(logListeningActivity).toHaveBeenLastCalledWith(5, 3);

    // Resume and play 4.4s more. pending = 0.4 (residual) + 4.4 = 4.8 → round 5.
    // Total reported: 3 + 5 = 8s for 7.8s actually listened (delta +0.2).
    // Pre-fix behavior: floor(3.4)=3 then floor(4.4)=4 → 7s for 7.8s (delta -0.8),
    // and the dropped fractions could compound across many short pauses.
    nowSpy.mockReturnValue(4400);
    act(() => {
      audio.__lrAllowPlayback = true;
      fireEvent.play(audio);
    });
    await act(async () => {});

    nowSpy.mockReturnValue(8800);
    act(() => {
      fireEvent.pause(audio);
    });

    expect(logListeningActivity).toHaveBeenCalledTimes(2);
    expect(logListeningActivity).toHaveBeenLastCalledWith(5, 5);
  });

  test('does not double-log listening duration on repeated pause events', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const { audio } = await renderReadyLessonPlayer();

    act(() => {
      audio.__lrAllowPlayback = true;
      fireEvent.play(audio);
    });
    await act(async () => {});

    nowSpy.mockReturnValue(9000);
    act(() => {
      fireEvent.pause(audio);
      fireEvent.pause(audio);
    });

    expect(logListeningActivity).toHaveBeenCalledTimes(1);
    expect(logListeningActivity).toHaveBeenCalledWith(5, 8);
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

  test('does not force-save progress on routine rerenders', async () => {
    getAudioLessonProgress.mockResolvedValue({ currentPosition: 0 });

    const { container, rerender, unmount } = render(
      <AudiobookPlayer
        type="lesson"
        audioSrc="https://example.com/lesson.mp3"
        textId={42}
        languageId={5}
      />
    );

    await waitFor(() => {
      expect(screen.getByTitle(/Play/)).toBeInTheDocument();
    });

    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();
    Object.defineProperty(audio, 'currentTime', {
      configurable: true,
      writable: true,
      value: 12
    });

    rerender(
      <AudiobookPlayer
        type="lesson"
        audioSrc="https://example.com/lesson.mp3"
        textId={42}
        languageId={6}
      />
    );

    expect(updateAudioLessonProgress).not.toHaveBeenCalled();

    unmount();

    await waitFor(() => {
      expect(updateAudioLessonProgress).toHaveBeenCalledTimes(1);
    });
  });

  test('does not apply delayed restore after playback intent has started', async () => {
    const deferredProgress = createDeferred();
    getAudioLessonProgress.mockReturnValue(deferredProgress.promise);

    const { container } = render(
      <AudiobookPlayer
        type="lesson"
        audioSrc="https://example.com/lesson.mp3"
        textId={42}
        languageId={5}
      />
    );

    await waitFor(() => {
      expect(screen.getByTitle(/Play/)).toBeInTheDocument();
    });

    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();
    Object.defineProperty(audio, 'currentTime', {
      configurable: true,
      writable: true,
      value: 0
    });

    fireEvent.click(screen.getByTitle(/Play/));

    await act(async () => {
      deferredProgress.resolve({
        currentPosition: 45,
        updatedAt: new Date().toISOString()
      });
      await deferredProgress.promise;
    });

    await waitFor(() => {
      expect(audio.currentTime).toBe(0);
    });
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
      expect(window.HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(1);
    });

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

    const { container, rerender } = render(
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

    rerender(
      <AudiobookPlayer
        type="lesson"
        audioSrc="https://example.com/lesson-2.mp3"
        textId={42}
        languageId={5}
      />
    );

    await waitFor(() => {
      expect(audio.getAttribute('src')).toBe('https://example.com/lesson-2.mp3');
    });

    Object.defineProperty(audio, 'currentSrc', {
      configurable: true,
      value: 'https://example.com/lesson-2.mp3'
    });

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

  test('surfaces non-abort media errors', async () => {
    getAudioLessonProgress.mockResolvedValue({ currentPosition: 0 });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

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
        code: 4,
        message: 'The media resource could not be loaded.'
      }
    });

    fireEvent.error(audio);

    expect(errorSpy).toHaveBeenCalledWith(
      'Audio Error:',
      expect.objectContaining({
        mediaErrorCode: 4
      })
    );
    expect(await screen.findByText('Error loading audio.')).toBeInTheDocument();
  });

  test('segment with repeatCount=2 replays once then stops at endTime', async () => {
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
          requestId: 'repeat-2',
          startTime: 5,
          endTime: 10,
          repeatCount: 2,
          forcePlay: true
        }}
      />
    );

    await waitFor(() => {
      expect(getAudioLessonProgress).toHaveBeenCalledWith(42);
    });
    await waitFor(() => {
      expect(screen.getByTitle(/Play/)).toBeInTheDocument();
    });

    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();

    // Simulate time reaching endTime on the first pass — should replay (remainingRepeats 2→1)
    act(() => {
      Object.defineProperty(audio, 'currentTime', {
        configurable: true, writable: true, value: 10
      });
      fireEvent.timeUpdate(audio);
    });

    // After first repeat, pause should NOT have been called (only on final stop)
    expect(window.HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();

    // Simulate time reaching endTime on the second pass — should stop
    act(() => {
      Object.defineProperty(audio, 'currentTime', {
        configurable: true, writable: true, value: 10
      });
      fireEvent.timeUpdate(audio);
    });

    // After second pass, segment should be done — pause called
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    // onTimeUpdate should be called with the endTime when segment finishes
    expect(onTimeUpdate).toHaveBeenCalledWith(10);
  });

  test('segment with repeatCount=1 stops at endTime without replay', async () => {
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
          requestId: 'repeat-1',
          startTime: 2,
          endTime: 4,
          repeatCount: 1,
          forcePlay: true
        }}
      />
    );

    await waitFor(() => {
      expect(getAudioLessonProgress).toHaveBeenCalledWith(42);
    });
    await waitFor(() => {
      expect(screen.getByTitle(/Play/)).toBeInTheDocument();
    });

    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();

    // Clear play calls from initial segment start
    window.HTMLMediaElement.prototype.play.mockClear();

    // Simulate time reaching endTime
    act(() => {
      Object.defineProperty(audio, 'currentTime', {
        configurable: true, writable: true, value: 4
      });
      fireEvent.timeUpdate(audio);
    });

    // Should pause immediately, no replay
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(onTimeUpdate).toHaveBeenCalledWith(4);
  });

  test('very short segment (< 0.1s) does not end prematurely', async () => {
    getAudioLessonProgress.mockResolvedValue({ currentPosition: 0 });

    const { container } = render(
      <AudiobookPlayer
        type="lesson"
        audioSrc="https://example.com/lesson.mp3"
        textId={42}
        languageId={5}
        segmentPlaybackRequest={{
          requestId: 'short-segment',
          startTime: 5,
          endTime: 5.05,
          repeatCount: 1,
          forcePlay: true
        }}
      />
    );

    await waitFor(() => {
      expect(getAudioLessonProgress).toHaveBeenCalledWith(42);
    });
    await waitFor(() => {
      expect(screen.getByTitle(/Play/)).toBeInTheDocument();
    });

    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();

    // Time at startTime — the boundary check uses
    // Math.max(endTime - 0.05, startTime) which equals startTime (5) for this segment
    // So time=5 >= 5 triggers the end. Verify it completes cleanly without crash.
    act(() => {
      Object.defineProperty(audio, 'currentTime', {
        configurable: true, writable: true, value: 5
      });
      fireEvent.timeUpdate(audio);
    });

    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  test('keyboard shortcut Space toggles play/pause', async () => {
    getAudioLessonProgress.mockResolvedValue({ currentPosition: 0 });

    const { container } = render(
      <AudiobookPlayer
        type="lesson"
        audioSrc="https://example.com/lesson.mp3"
        textId={42}
        languageId={5}
      />
    );

    await waitFor(() => {
      expect(screen.getByTitle(/Play/)).toBeInTheDocument();
    });

    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();

    // Audio starts paused — Space should trigger play via togglePlayPause
    // togglePlayPause sets __lrAllowPlayback = true then calls play()
    act(() => {
      fireEvent.keyDown(window, { key: ' ' });
    });

    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();

    // Simulate the browser firing the play event (marks as playing)
    act(() => {
      Object.defineProperty(audio, 'paused', {
        configurable: true, get: () => false
      });
      // Set the intent flag as togglePlayPause would have
      audio.__lrAllowPlayback = true;
      fireEvent.play(audio);
    });

    // Press Space again — audio is not paused, so togglePlayPause calls pause()
    act(() => {
      fireEvent.keyDown(window, { key: ' ' });
    });

    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  test('track advancement on ended event in book mode', async () => {
    getAudiobookProgress.mockResolvedValue({
      currentAudiobookTrackId: 'track-1',
      currentAudiobookPosition: 0
    });

    const book = {
      bookId: 10,
      languageId: 3,
      audiobookTracks: [
        { trackId: 'track-1', filePath: 'audio/track-1.mp3' },
        { trackId: 'track-2', filePath: 'audio/track-2.mp3' }
      ]
    };

    const { container } = render(
      <AudiobookPlayer type="book" book={book} />
    );

    await waitFor(() => {
      expect(getAudiobookProgress).toHaveBeenCalledWith(10);
    });

    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();

    // Wait for UI to fully render
    await waitFor(() => {
      expect(screen.getByTitle(/Play/)).toBeInTheDocument();
    });

    // Fire ended event — should advance to track 2
    act(() => {
      fireEvent.ended(audio);
    });

    // After advancing, the audio source should change to track-2
    await waitFor(() => {
      const src = audio.getAttribute('src');
      expect(src).toContain('track-2');
    });
  });

  test('last track ended event stops playback instead of advancing', async () => {
    getAudiobookProgress.mockResolvedValue({
      currentAudiobookTrackId: 'track-1',
      currentAudiobookPosition: 0
    });

    const onPlaybackStateChange = jest.fn();

    const book = {
      bookId: 10,
      languageId: 3,
      audiobookTracks: [
        { trackId: 'track-1', filePath: 'audio/track-1.mp3' }
      ]
    };

    const { container } = render(
      <AudiobookPlayer type="book" book={book} onPlaybackStateChange={onPlaybackStateChange} />
    );

    await waitFor(() => {
      expect(screen.getByTitle(/Play/)).toBeInTheDocument();
    });

    const audio = container.querySelector('audio');

    // Fire ended event on the only/last track
    act(() => {
      fireEvent.ended(audio);
    });

    // Should signal playback stopped, not advance
    expect(onPlaybackStateChange).toHaveBeenCalledWith(false);
  });

});
