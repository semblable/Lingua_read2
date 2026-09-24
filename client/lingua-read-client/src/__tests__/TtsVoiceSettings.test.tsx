import React from 'react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../utils/browserTts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/browserTts')>()),
  isSpeechSynthesisSupported: vi.fn(() => true),
  getVoicesForLanguage: vi.fn(),
  speakText: vi.fn(() => Promise.resolve())
}));

import ReadingSettings from '../components/settings/ReadingSettings';
import type { Settings } from '../contexts/SettingsContext';
import { getPreferredVoiceURI, getVoicesForLanguage, speakText } from '../utils/browserTts';

const voice = (name: string, lang: string, localService = true) =>
  ({ name, lang, voiceURI: `uri:${name}`, default: false, localService }) as SpeechSynthesisVoice;

const LANGUAGES = [
  { languageId: 1, name: 'French', code: 'FR' },
  { languageId: 2, name: 'German', code: 'DE' }
];

const renderSettings = (sentenceTtsEnabled: boolean) =>
  render(
    <ReadingSettings
      settings={{ sentenceTtsEnabled } as unknown as Settings}
      handleChange={vi.fn()}
      languages={LANGUAGES}
      loadingLanguages={false}
      onSaveProviderKey={vi.fn()}
      onClearProviderKey={vi.fn()}
    />
  );

describe('TtsVoiceSettings in Reading settings', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(speakText).mockClear();
    vi.mocked(getVoicesForLanguage).mockImplementation(async (code) =>
      code === 'FR'
        ? [voice('Microsoft Denise Online (Natural) - French (France)', 'fr-FR', false), voice('Microsoft Hortense - French (France)', 'fr-FR')]
        : []
    );
  });

  test('is hidden while browser text-to-speech is off', () => {
    renderSettings(false);

    expect(screen.queryByTestId('tts-voice-settings')).not.toBeInTheDocument();
  });

  test('lists voices per language, labels natural ones, and says when a language has none', async () => {
    renderSettings(true);

    expect(await screen.findByRole('option', { name: /Denise.*· natural · needs internet$/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Microsoft Hortense - French (France) (fr-FR)' })).toBeInTheDocument();
    expect(await screen.findByText('No German voice on this device.')).toBeInTheDocument();
  });

  test('saves the choice on this device and previews with it', async () => {
    renderSettings(true);
    await screen.findByRole('option', { name: /Hortense/ });

    fireEvent.change(screen.getByLabelText('French'), { target: { value: 'uri:Microsoft Hortense - French (France)' } });
    expect(getPreferredVoiceURI('FR')).toBe('uri:Microsoft Hortense - French (France)');

    fireEvent.click(screen.getByRole('button', { name: 'Preview French voice' }));
    expect(speakText).toHaveBeenCalledWith(expect.objectContaining({
      languageCode: 'FR',
      voiceURI: 'uri:Microsoft Hortense - French (France)'
    }));

    fireEvent.change(screen.getByLabelText('French'), { target: { value: '' } });
    expect(getPreferredVoiceURI('FR')).toBeNull();
  });
});
