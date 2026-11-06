import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import OfflineIndicator from '../components/offline/OfflineIndicator';
import { updateAudiobookProgress, updateAudioLessonProgress, logListeningActivity } from '../utils/api/audiobook';
import { clearAll, pending } from '../utils/offline/syncQueue';
import { productionSyncHandlers } from '../utils/offline/handlers';
import { isOfflineQueued } from '../utils/offline/enqueueIfOffline';

test('expired audio writes retain work and open shared login even with an initially empty queue', async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  await clearAll();
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('', { status: 401 }));
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const originalLocation = window.location;
  const redirect = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: {
    pathname: '/texts/1', search: '', hash: '', set href(value: string) { redirect(value); }
  } });
  try {
    render(<><textarea aria-label="Reader note" defaultValue="Keep this note" />
      <OfflineIndicator handlers={productionSyncHandlers} /></>);
    await act(async () => {
      expect(isOfflineQueued(await updateAudiobookProgress(17, { currentAudiobookTrackId: 2, currentAudiobookPosition: 42 }))).toBe(true);
      expect(isOfflineQueued(await updateAudioLessonProgress(1, { currentPosition: 32 }))).toBe(true);
      expect(isOfflineQueued(await logListeningActivity(1, 10))).toBe(true);
    });
    await screen.findByRole('dialog');
    expect(await pending()).toBe(3);
    expect(redirect).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Reader note')).toHaveValue('Keep this note');
    fetch.mockImplementation(async () => new Response('{}', { headers: { 'content-type': 'application/json' } }));
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(async () => expect(await pending()).toBe(0));
    expect(redirect).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Reader note')).toHaveValue('Keep this note');
  } finally {
    fetch.mockRestore(); errors.mockRestore();
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    await clearAll();
  }
});
