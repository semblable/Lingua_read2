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
    getAudiobookProgress.mockReset();
    updateAudiobookProgress.mockReset();
    getAudioLessonProgress.mockReset();
    updateAudioLessonProgress.mockReset();
    logListeningActivity.mockReset();
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
      expect(screen.queryByTitle('Play (Space or `)')).toBeInTheDocument();
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
      expect(screen.queryByTitle('Play (Space or `)')).toBeInTheDocument();
    });
  });
});
