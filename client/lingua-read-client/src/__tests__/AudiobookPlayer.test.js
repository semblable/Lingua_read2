import React from 'react';
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

const setupAudioElement = (audio) => {
  let paused = true;
  let currentTime = 0;
  let duration = 120;
  let readyState = 2;
  let networkState = 1;

  Object.defineProperty(audio, 'paused', { get: () => paused });
  Object.defineProperty(audio, 'currentTime', {
    get: () => currentTime,
    set: (value) => {
      currentTime = value;
    }
  });
  Object.defineProperty(audio, 'duration', {
    get: () => duration,
    set: (value) => {
      duration = value;
    }
  });
  Object.defineProperty(audio, 'readyState', {
    get: () => readyState,
    set: (value) => {
      readyState = value;
    }
  });
  Object.defineProperty(audio, 'networkState', {
    get: () => networkState,
    set: (value) => {
      networkState = value;
    }
  });

  audio.play = jest.fn(() => {
    paused = false;
    audio.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  audio.pause = jest.fn(() => {
    paused = true;
    audio.dispatchEvent(new Event('pause'));
  });
  audio.load = jest.fn();
};

describe('AudiobookPlayer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    getAudiobookProgress.mockReset();
    updateAudiobookProgress.mockReset();
    getAudioLessonProgress.mockReset();
    updateAudioLessonProgress.mockReset();
    logListeningActivity.mockReset();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('book mode restores progress and saves on pause', async () => {
    getAudiobookProgress.mockResolvedValue({
      currentAudiobookTrackId: 'track-2',
      currentAudiobookPosition: 12
    });
    updateAudiobookProgress.mockResolvedValue({});

    const book = {
      bookId: 10,
      languageId: 3,
      audiobookTracks: [
        { trackId: 'track-1', filePath: 'audio/track-1.mp3' },
        { trackId: 'track-2', filePath: 'audio/track-2.mp3' }
      ]
    };

    const { container } = render(<AudiobookPlayer type="book" book={book} />);
    const audio = container.querySelector('audio');
    setupAudioElement(audio);

    audio.duration = 100;
    audio.currentTime = 12;
    fireEvent(audio, new Event('loadedmetadata'));
    fireEvent(audio, new Event('timeupdate'));

    await waitFor(() => {
      expect(screen.getByText('00:12/01:40')).toBeInTheDocument();
    });

    const playButton = screen.getByTitle('Play (Space or `)');
    fireEvent.click(playButton);

    const pauseButton = screen.getByTitle('Pause (Space or `)');
    fireEvent.click(pauseButton);

    await waitFor(() => {
      expect(updateAudiobookProgress).toHaveBeenCalledWith(10, {
        currentAudiobookTrackId: 'track-2',
        currentAudiobookPosition: 12
      });
    });
  });

  test('lesson mode restores progress, updates time, and saves on pause', async () => {
    getAudioLessonProgress.mockResolvedValue({ currentPosition: 30 });
    updateAudioLessonProgress.mockResolvedValue({});

    const onTimeUpdate = jest.fn();
    const { container } = render(
      <AudiobookPlayer
        type="lesson"
        audioSrc="https://example.com/lesson.mp3"
        textId={42}
        languageId={5}
        onTimeUpdate={onTimeUpdate}
      />
    );

    const audio = container.querySelector('audio');
    setupAudioElement(audio);

    audio.duration = 200;
    audio.currentTime = 30;
    fireEvent(audio, new Event('loadedmetadata'));

    await waitFor(() => {
      expect(onTimeUpdate).toHaveBeenCalledWith(30);
    });

    audio.currentTime = 35;
    fireEvent(audio, new Event('timeupdate'));
    expect(onTimeUpdate).toHaveBeenCalledWith(35);

    const playButton = screen.getByTitle('Play (Space or `)');
    fireEvent.click(playButton);

    const pauseButton = screen.getByTitle('Pause (Space or `)');
    fireEvent.click(pauseButton);

    await waitFor(() => {
      expect(updateAudioLessonProgress).toHaveBeenCalledWith(42, { currentPosition: 35 });
    });
  });
});
